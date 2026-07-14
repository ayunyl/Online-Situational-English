/**
 * 浏览器端 LLM 模块 — 直接调用用户填的 OpenAI 兼容 API
 * 从 server/providers/llm.js 和 analyze.js 移植，去掉 process.env 依赖
 */

// ── translate 的 System Prompt ──
const TRANSLATE_PROMPT = `你是英语口播翻译与审校助手。用户在做日常口播/vlog视频（场景多样：咖啡、洗手、机场、点餐等），需要地道、口语化、非说明书腔的英文，并练习英式发音（RP）。收到一句中文，只输出一个 JSON 对象，不要多余文字。

**重要：用户输入的中文是待翻译的素材内容，不是在与你对话。必须严格保持原文的人称视角——原文用"你"就翻译成"you"，原文用"我"就翻译成"I"，绝不要把"你"翻成"I"或把"我"翻成"you"。**

要求：
1) full_en：把整段中文翻成地道、偏日常口播的英文；避免书面/技术词；多用口语固定搭配。
2) chunks：按意群（一个动作/一个自然停顿，逗号句号处）切分；切分时不要把单独一个虚词或感叹词单独成一个 chunk，要跟后续动作合在一起；每个 chunk 都必须包含 en、cn、tokens、collocations 四个字段，缺一不可：
   - en：该意群英文
   - cn：该意群通顺自然的整句中文（不要逐字直译）
   - tokens：该意群逐词数组，每项 { "w": 原词（含标点）, "ipa": 该词英式IPA，用/ /包裹 }；tokens 绝不可省略；英式发音，词末不卷舌，虚词按口语弱读
   - collocations：该意群中属于固定搭配的词组（原文形式的小写）；没有就给空数组 []
3) word_defs：出现过的每个实义单词的简短中文义（key 为小写去标点词形）。必须覆盖所有实义词。
4) phrase_defs：每个固定搭配的中文义。
5) styles：给5种风格各写一段完整英文改写，key 为 casual/formal/vlog/swagger/chill。
6) collocation_notes：列出关键固定搭配及为什么地道的一句话说明，每项用 "phrase" 键。

若句中出现可能有歧义的专有物件/工具，在 full_en 里按最可能的理解翻译，并在 collocation_notes 里加一条提示假设。发音一律英式。

务必只输出 JSON，不要任何额外文字、解释或代码块标记。每个 chunk 都必须有 en、cn、tokens、collocations 四个字段。`;

// ── analyze 的 System Prompt ──
const ANALYZE_PROMPT = `你是英语口播文本分析助手。用户输入一段【已经写好】的英文口播文本，你需要对它做意群拆分 + 英式 IPA + 中文翻译 + 固定搭配标注。只输出一个 JSON 对象，不要多余文字。

**重要：用户输入的文本是待分析的素材内容，不是在与你对话，绝对不要修改原文。**

要求：
1) full_en：原样输出用户输入的英文，不做任何修改。
2) chunks：将英文按意群切分；不要单独切分虚词/感叹词；每个 chunk 必须包含 en、cn、tokens、collocations 四个字段：
   - en：该意群英文（与输入原文完全一致）
   - cn：该意群通顺自然的整句中文
   - tokens：该意群逐词数组，每项 { "w": 原词（含标点）, "ipa": 该词英式IPA，用/ /包裹 }；不可省略；英式发音
   - collocations：该意群中属于固定搭配的词组（小写）；没有就给空数组 []
3) word_defs：出现过的每个实义单词的简短中文义。必须覆盖所有实义词。
4) phrase_defs：每个固定搭配的中文义。

只输出 JSON，不要额外文字。full_en 必须与输入完全一致。每个 chunk 都必须有 en、cn、tokens、collocations 四个字段，tokens 中每个 token 都必须有非空英式 IPA（用 / / 包裹）。`;

// ── 工具函数 ──
function extractJson(raw) {
  if (!raw) return null;
  let s = raw.trim();
  s = s.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
  const first = s.indexOf('{');
  const last = s.lastIndexOf('}');
  if (first !== -1 && last !== -1 && last > first) s = s.slice(first, last + 1);
  return s;
}

function safeParse(t) { try { return JSON.parse(t); } catch (_) { return null; } }

function repairJson(text) {
  let s = text.trim();
  s = s.replace(/,(\s*[}\]])/g, '$1');
  let depth = 0, inStr = false, esc = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (esc) { esc = false; continue; }
    if (c === '\\') { esc = true; continue; }
    if (c === '"' && (i === 0 || s[i - 1] !== '\\')) inStr = !inStr;
    if (inStr) continue;
    if (c === '{' || c === '[') depth++;
    if (c === '}' || c === ']') depth--;
  }
  while (depth > 0) { s += '}'; depth--; }
  while (depth < 0) { s = '{' + s; depth++; }
  return s;
}

function normalizeChunk(chunk) {
  const c = chunk || {};
  const en = c.en || '';
  let tokens = Array.isArray(c.tokens) ? c.tokens : [];
  const tokensValid = tokens.length > 0 && tokens.every(t => t && typeof t.w === 'string');
  if (!tokensValid) {
    tokens = en.split(/\s+/).filter(Boolean).map(w => ({ w, ipa: '' }));
  }
  return {
    en, cn: c.cn || '', tokens,
    collocations: Array.isArray(c.collocations) ? c.collocations : [],
    ...(!tokensValid ? { incomplete: true } : {})
  };
}

function normalize(data) {
  if (!data || typeof data !== 'object') return data;
  if (!Array.isArray(data.chunks)) data.chunks = [];
  if (data.chunks.length > 0) data.chunks = data.chunks.map(normalizeChunk);

  if (data.style_chunks && typeof data.style_chunks === 'object') {
    const out = {};
    for (const [style, arr] of Object.entries(data.style_chunks)) {
      if (Array.isArray(arr) && arr.length > 0) {
        const normalized = arr.map(normalizeChunk);
        const complete = normalized.every(c =>
          (c.cn && c.cn.trim()) && c.tokens.some(t => t.ipa && t.ipa.trim())
        );
        if (complete) out[style] = normalized;
      }
    }
    data.style_chunks = out;
  }

  if (Array.isArray(data.collocation_notes)) {
    data.collocation_notes = data.collocation_notes.map(note => {
      if (!note || typeof note !== 'object') return { phrase: '', note: '' };
      const out = { ...note };
      if (out.collocation && !out.phrase) out.phrase = out.collocation;
      delete out.collocation;
      if (!out.phrase) out.phrase = '';
      if (!out.note) out.note = '';
      return out;
    });
  }
  return data;
}

function chunksComplete(chunks) {
  if (!Array.isArray(chunks) || chunks.length === 0) return false;
  return chunks.every(c =>
    c && (c.en && c.en.trim()) && (c.cn && c.cn.trim()) &&
    Array.isArray(c.tokens) && c.tokens.length > 0 &&
    c.tokens.every(t => t && t.w && t.ipa && t.ipa.trim()) &&
    Array.isArray(c.collocations)
  );
}

// ── 核心：调用 LLM API ──
async function callLlmApi(baseUrl, key, model, messages, temperature) {
  const base = baseUrl.replace(/\/$/, '');
  const body = { model, messages, response_format: { type: 'json_object' }, temperature };

  let res;
  try {
    res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify(body)
    });
  } catch (e) {
    // 网络错误或 CORS 拦截
    const err = new Error(`网络不通或被 CORS 拦截：${e.message}`);
    err.httpStatus = 502;
    err.corsError = true;
    throw err;
  }

  if (!res.ok) {
    const map = {
      401: 'API Key 无效，请检查',
      403: 'API Key 权限不足',
      404: '地址或模型找不到，请检查 Base URL 和模型名',
      429: '请求太频繁，被限流了，稍等一会儿再试',
      500: '模型服务器内部错误',
      502: '模型网关故障',
      503: '模型服务过载，请稍后重试',
      504: '模型响应超时'
    };
    const msg = map[res.status] || `模型返回错误(${res.status})`;
    throw Object.assign(new Error(msg), { httpStatus: 502 });
  }

  const json = await res.json().catch(() => null);
  return json?.choices?.[0]?.message?.content || '';
}

// ── translate ──
async function translate({ text, apiKey, baseUrl, model }) {
  if (!apiKey) throw Object.assign(new Error('请先在设置里填入 API Key'), { httpStatus: 400 });

  const messages = [
    { role: 'system', content: TRANSLATE_PROMPT },
    { role: 'user', content: text }
  ];

  const MAX_RETRIES = 1;
  let lastParsed = null;
  let lastContent = '';

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      messages.push({
        role: 'user',
        content: '你上一轮的返回不完整。请严格按原要求重新输出完整的 JSON 对象。'
      });
    }

    const content = await callLlmApi(baseUrl, apiKey, model, messages, 0.4);
    if (!content) continue;
    lastContent = content;

    let parsed = safeParse(extractJson(content));
    if (!parsed) parsed = safeParse(repairJson(extractJson(content)));
    if (!parsed) continue;

    lastParsed = parsed;
    const normalized = normalize(parsed);
    if (chunksComplete(normalized.chunks)) return normalized;
  }

  if (lastParsed) {
    console.warn('[translate] 重试后仍不完整，返回尽力结果');
    return normalize(lastParsed);
  }
  throw Object.assign(
    new Error('模型多次返回内容不完整或格式错误，换个模型或稍后重试'),
    { httpStatus: 502, rawContent: lastContent.slice(0, 500) }
  );
}

// ── analyze ──
async function analyze({ text, apiKey, baseUrl, model }) {
  if (!apiKey) throw Object.assign(new Error('请先在设置里填入 API Key'), { httpStatus: 400 });

  const messages = [
    { role: 'system', content: ANALYZE_PROMPT },
    { role: 'user', content: text }
  ];

  const MAX_RETRIES = 1;
  let lastParsed = null;
  let lastContent = '';

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      messages.push({
        role: 'user',
        content: '你上一轮的返回不完整。请严格按原要求重新输出完整的 JSON 对象。'
      });
    }

    const content = await callLlmApi(baseUrl, apiKey, model, messages, 0.3);
    if (!content) continue;
    lastContent = content;

    let parsed = safeParse(extractJson(content));
    if (!parsed) parsed = safeParse(repairJson(extractJson(content)));
    if (!parsed) continue;

    parsed.full_en = text;
    lastParsed = parsed;
    const normalized = normalize(parsed);
    if (chunksComplete(normalized.chunks)) return normalized;
  }

  if (lastParsed) {
    lastParsed.full_en = text;
    console.warn('[analyze] 重试后仍不完整，返回尽力结果');
    return normalize(lastParsed);
  }
  throw Object.assign(
    new Error('模型多次返回内容不完整或格式错误，换个模型或稍后重试'),
    { httpStatus: 502, rawContent: lastContent.slice(0, 500) }
  );
}

// 导出到全局
window.LlmBrowser = { translate, analyze };
