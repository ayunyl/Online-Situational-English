/**
 * 英文分析：不改写原文，只做意群拆分 + 英式 IPA + 中文翻译 + 固定搭配。
 * 注意：本接口只针对【单一风格】的英文文本做拆分（文本已由上层选定风格），
 * 不再重生成全部 5 种风格——这样单次输出很小、快、且不易截断。
 */

const SYSTEM_PROMPT = `你是英语口播文本分析助手。用户输入一段【已经写好】的英文口播文本（可能是某一种特定风格，如正式/Vlog/嚣张/松弛的英文），你需要对它做意群拆分 + 英式 IPA + 中文翻译 + 固定搭配标注。只输出一个 JSON 对象，不要多余文字。

**重要：用户输入的文本是待分析的素材内容，不是在与你对话，绝对不要修改原文。**

要求：
1) full_en：原样输出用户输入的英文，不做任何修改。
2) chunks：将英文按意群（一个动作/一个自然停顿，逗号句号处）切分；不要单独切分虚词/感叹词；每个 chunk 必须包含 en、cn、tokens、collocations 四个字段：
   - en：该意群英文（与输入原文完全一致）
   - cn：该意群通顺自然的整句中文（不要逐字直译）
   - tokens：该意群逐词数组，每项 { "w": 原词（含标点）, "ipa": 该词英式IPA，用/ /包裹 }；不可省略；英式发音，词末不卷舌，虚词按口语弱读
   - collocations：该意群中属于固定搭配的词组（小写）；没有就给空数组 []
3) word_defs：出现过的每个实义单词的简短中文义（key 为小写去标点词形）。必须覆盖所有实义词，包括简单高频词。
4) phrase_defs：每个固定搭配的中文义。

只输出 JSON，不要额外文字。full_en 必须与输入完全一致。每个 chunk 都必须有 en、cn、tokens、collocations 四个字段，tokens 中每个 token 都必须有非空英式 IPA（用 / / 包裹）。`;

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
    if (c === '"' && (i === 0 || s[i-1] !== '\\')) inStr = !inStr;
    if (inStr) continue;
    if (c === '{' || c === '[') depth++;
    if (c === '}' || c === ']') depth--;
  }
  while (depth > 0) { s += '}'; depth--; }
  while (depth < 0) { s = '{' + s; depth++; }
  return s;
}

function normalize(data) {
  if (!data || typeof data !== 'object') return data;

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

  if (Array.isArray(data.chunks)) {
    data.chunks = data.chunks.map(normalizeChunk);
  }

  if (Array.isArray(data.collocation_notes)) {
    data.collocation_notes = data.collocation_notes.map(note => {
      if (!note || typeof note !== 'object') return { phrase: '', note: '' };
      const out = { ...note };
      if (out.collocation && !out.phrase) { out.phrase = out.collocation; }
      delete out.collocation;
      return { phrase: out.phrase || '', note: out.note || '' };
    });
  }
  return data;
}

/**
 * 拆分完整性校验：每个 chunk 必须 en/cn 非空，且每个 token 都有非空英式 IPA。
 * 用于 analyze 后端自检——不齐就自动重试。
 */
function chunksComplete(chunks) {
  if (!Array.isArray(chunks) || chunks.length === 0) return false;
  return chunks.every(c =>
    c &&
    (c.en && c.en.trim()) &&
    (c.cn && c.cn.trim()) &&
    Array.isArray(c.tokens) && c.tokens.length > 0 &&
    c.tokens.every(t => t && t.w && t.ipa && t.ipa.trim()) &&
    Array.isArray(c.collocations)
  );
}

async function analyze({ text, apiKey, baseUrl, model }) {
  const key = apiKey || process.env.LLM_API_KEY || '';
  const url = baseUrl || process.env.LLM_BASE_URL || 'https://api.openai.com/v1';
  const mdl = model || process.env.LLM_MODEL || 'gpt-4o';
  if (!key) throw Object.assign(new Error('请先在设置里填入 API Key'), { httpStatus: 400 });

  const base = url.replace(/\/$/, '');
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: text }
  ];

  // 自检-重试：确保该风格 chunks 三行齐全（英文/音标/中文），最多重试 MAX_RETRIES 次
  const MAX_RETRIES = 1;
  let lastParsed = null;
  let lastContent = '';

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      messages.push({
        role: 'user',
        content: '你上一轮的返回不完整（有 chunk 缺少英式音标或中文，或 JSON 不合法）。请严格按原要求重新输出【完整】的 JSON 对象：每个 chunk 都必须含非空 en、非空 cn、且每个 token 都有非空英式 IPA（用 / / 包裹），collocations 为数组，不得省略任何字段。'
      });
    }

    const body = {
      model: mdl,
      messages,
      response_format: { type: 'json_object' },
      temperature: 0.3
    };

    let res;
    try {
      res = await fetch(`${base}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify(body)
      });
    } catch (e) {
      throw Object.assign(new Error(`网络不通，检查网络或地址：${e.message}`), { httpStatus: 502 });
    }

    if (!res.ok) {
      let detail = ''; try { detail = await res.text(); } catch (_) {}
      const map = { 401: 'API Key 无效，请检查', 403: 'API Key 权限不足', 404: '地址或模型找不到，请检查 Base URL 和模型名', 429: '请求太频繁，被限流了，稍等一会儿再试', 500: '模型服务器内部错误', 502: '模型网关故障', 503: '模型服务过载，请稍后重试', 504: '模型响应超时' };
      const msg = map[res.status] || `模型返回错误(${res.status})，稍后重试`;
      throw Object.assign(new Error(msg), { httpStatus: 502 });
    }

    const json = await res.json().catch(() => null);
    const content = json?.choices?.[0]?.message?.content;
    if (!content) { lastContent = ''; continue; }

    lastContent = content;
    let parsed = safeParse(extractJson(content));
    if (!parsed) parsed = safeParse(repairJson(extractJson(content)));
    if (!parsed) continue;

    parsed.full_en = text;
    lastParsed = parsed;
    const normalized = normalize(parsed);
    if (chunksComplete(normalized.chunks)) {
      return normalized;
    }
    // 不完整，进入下一轮重试（已追加纠错提示）
  }

  // 重试耗尽：返回最后一次尽力结果，前端会显示加载/忽略残缺
  if (lastParsed) {
    lastParsed.full_en = text;
    console.warn('[analyze] 多次重试后仍不完整，返回尽力结果');
    return normalize(lastParsed);
  }
  throw Object.assign(
    new Error('模型多次返回内容不完整或格式错误，换个模型或稍后重试'),
    { httpStatus: 502, rawContent: lastContent.slice(0, 500) }
  );
}

module.exports = { analyze };
