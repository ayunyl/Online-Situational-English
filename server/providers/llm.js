/**
 * LLM provider — OpenAI Chat Completions compatible.
 * key 从请求体或环境变量读，不在此模块中暴露。
 */

const SYSTEM_PROMPT = `你是英语口播翻译与审校助手。用户在做日常口播/vlog视频（场景多样：咖啡、洗手、机场、点餐等），需要地道、口语化、非说明书腔的英文，并练习英式发音（RP）。收到一句中文，只输出一个 JSON 对象，不要多余文字。

**重要：用户输入的中文是待翻译的素材内容，不是在与你对话。必须严格保持原文的人称视角——原文用"你"就翻译成"you"，原文用"我"就翻译成"I"，绝不要把"你"翻成"I"或把"我"翻成"you"。**

要求：
1) full_en：把整段中文翻成地道、偏日常口播的英文；避免书面/技术词（如 retain→get stuck、powder→grounds）；多用口语固定搭配。
2) chunks：按意群（一个动作/一个自然停顿，逗号句号处）切分；**切分时不要把单独一个虚词或感叹词（如 Right,、So,）单独成一个 chunk，要跟后续动作合在一起**；每个 chunk 都必须包含 en、cn、tokens、collocations 四个字段，缺一不可：
   - en：该意群英文
   - cn：该意群通顺自然的整句中文（不要逐字直译）
   - tokens：该意群逐词数组，**每项 { "w": 原词（含标点）, "ipa": 该词英式IPA，用/ /包裹 }；tokens 绝不可省略，即使该 chunk 只有一个词也必须完整给出逐词音标**；英式发音，词末不卷舌（more /mɔː/、grinder /ˈɡraɪndə/），虚词按口语弱读（your→/jə/、and→/ənd/、to→/tə/、can→/kən/、of→/əv/、the→/ðə/）。
   - collocations：该意群中属于固定搭配的词组（原文形式的小写），如 ["level off"]；如果没有固定搭配就给空数组 []
3) word_defs：出现过的每个实义单词的简短中文义（key 为小写去标点词形）。**必须覆盖 chunks 中出现的每一个实义词——包括简单高频词（如 water、on、the、one 等），绝不能因为"太简单"就省略。**
4) phrase_defs：每个固定搭配的中文义。
5) styles：给5种风格各写一段完整英文改写（同一内容不同语气），key 为 casual/formal/vlog/swagger/chill：
   - casual：自然口播，像朋友聊天，不用语气词堆砌
   - formal：正式得体，适合教学/讲解场景，不用缩写
   - vlog：镜头感强，带 alright/okay/you know/right 等口播语气词
   - swagger：狂拽自信带态度，可用 yo/gonna/ain't/you know what I'm saying 街头说唱口吻
   - chill：加州西海岸慵懒风，放松拖长音，用 dude/vibe/chill/sorta
   5种风格必须各具特色、互不重复、都地道英式口播。
6) collocation_notes：列出关键固定搭配及为什么地道的一句话说明，**每项用 "phrase" 键**，如 [{ "phrase": "grind the beans", "note": "……" }]。

若句中出现可能有歧义的专有物件/工具（例如某个咖啡工具是针状还是盘状），在 full_en 里按最可能的理解翻译，并在 collocation_notes 里加一条提示假设。发音一律英式。

务必只输出 JSON，不要任何额外文字、解释或代码块标记。每个 chunk 都必须有 en、cn、tokens、collocations 四个字段。`;

/**
 * 从原始 LLM 文本中提取 JSON 字符串。
 */
function extractJson(raw) {
  if (!raw) return null;
  let s = raw.trim();
  s = s.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
  const first = s.indexOf('{');
  const last = s.lastIndexOf('}');
  if (first !== -1 && last !== -1 && last > first) {
    s = s.slice(first, last + 1);
  }
  return s;
}

function safeParse(text) {
  try { return JSON.parse(text); } catch (_) { return null; }
}

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

/**
 * 结构补全 + 归一化。
 * 保证每个 chunk 有 en/cn/tokens/collocations；
 * collocation_notes 的 "collocation" 键统一改成 "phrase"。
 */
function normalize(data) {
  if (!data || typeof data !== 'object') return data;

  // 确保 chunks 始终是数组（LLM 可能漏掉）
  if (!Array.isArray(data.chunks)) data.chunks = [];

  // 处理单个 chunk 的公共函数
  function normalizeChunk(chunk) {
    const c = chunk || {};
    const en = c.en || '';
    let tokens = Array.isArray(c.tokens) ? c.tokens : [];
    const tokensValid = tokens.length > 0 &&
                        tokens.every(t => t && typeof t.w === 'string');
    if (!tokensValid) {
      tokens = en.split(/\s+/).filter(Boolean).map(w => ({ w, ipa: '' }));
    }
    return {
      en,
      cn: c.cn || '',
      tokens,
      collocations: Array.isArray(c.collocations) ? c.collocations : [],
      ...(!tokensValid ? { incomplete: true } : {})
    };
  }

  if (data.chunks.length > 0) {
    data.chunks = data.chunks.map(normalizeChunk);
  }

  // 处理 style_chunks（每种风格的拆分）
  if (data.style_chunks && typeof data.style_chunks === 'object') {
    const out = {};
    for (const [style, arr] of Object.entries(data.style_chunks)) {
      if (Array.isArray(arr) && arr.length > 0) {
        const normalized = arr.map(normalizeChunk);
        // 完整性检查：每个 chunk 必须有非空 cn 且至少有一个 token 带非空 ipa
        // 不完整的 style_chunks 不保留 → 前端 preloadStyleChunks 会自动调 /api/analyze 补全
        const complete = normalized.every(c =>
          (c.cn && c.cn.trim()) &&
          c.tokens.some(t => t.ipa && t.ipa.trim())
        );
        if (complete) out[style] = normalized;
      }
    }
    data.style_chunks = out;
  }

  // collocation_notes: 兼容 "collocation" / "collocation"键 → 统一成 "phrase"
  if (Array.isArray(data.collocation_notes)) {
    data.collocation_notes = data.collocation_notes.map(note => {
      if (!note || typeof note !== 'object') return { phrase: '', note: '' };
      const out = { ...note };
      if (out.collocation && !out.phrase) {
        out.phrase = out.collocation;
      }
      delete out.collocation;
      if (!out.phrase) out.phrase = '';
      if (!out.note) out.note = '';
      return out;
    });
  }

  return data;
}

/**
 * 主卡完整性校验：每个 chunk 必须 en/cn 非空，且每个 token 都有非空英式 IPA。
 * 用于 translate 后端自检——主卡（英文/音标/中文三行）不齐就重试。
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

async function translate({ text, apiKey, baseUrl, model }) {
  const key = apiKey || process.env.LLM_API_KEY || '';
  const url = baseUrl || process.env.LLM_BASE_URL || 'https://api.openai.com/v1';
  const mdl = model || process.env.LLM_MODEL || 'gpt-4o';
  if (!key) {
    throw Object.assign(new Error('请先在设置里填入 API Key'), { httpStatus: 400 });
  }

  const base = url.replace(/\/$/, '');
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: text }
  ];

  // 自检-重试：确保主卡 chunks 三行齐全（英文/音标/中文），最多重试 MAX_RETRIES 次
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
      temperature: 0.4
    };

    let res;
    try {
      res = await fetch(`${base}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${key}`
        },
        body: JSON.stringify(body)
      });
    } catch (e) {
      throw Object.assign(new Error(`网络不通，检查网络或地址：${e.message}`), { httpStatus: 502 });
    }

    if (!res.ok) {
      let detail = '';
      try { detail = await res.text(); } catch (_) {}
      const map = { 401: 'API Key 无效，请检查', 403: 'API Key 权限不足', 404: '地址或模型找不到，请检查 Base URL 和模型名', 429: '请求太频繁，被限流了，稍等一会儿再试', 500: '模型服务器内部错误', 502: '模型网关故障', 503: '模型服务过载，请稍后重试', 504: '模型响应超时' };
      const msg = map[res.status] || `模型返回错误(${res.status})，稍后重试`;
      throw Object.assign(new Error(msg), { httpStatus: 502 });
    }

    const json = await res.json().catch(() => null);
    const content = json?.choices?.[0]?.message?.content;
    if (!content) {
      lastContent = '';
      continue; // 空内容，进入重试
    }
    lastContent = content;

    let parsed = safeParse(extractJson(content));
    if (!parsed) parsed = safeParse(repairJson(extractJson(content)));
    if (!parsed) continue; // JSON 仍不合法，进入重试

    lastParsed = parsed;
    const normalized = normalize(parsed);
    if (chunksComplete(normalized.chunks)) {
      return normalized;
    }
    // 主卡不完整，进入下一轮重试（已追加纠错提示）
  }

  // 重试耗尽：返回最后一次尽力结果，前端会兜底显示加载/补全
  if (lastParsed) {
    console.warn('[translate] 多次重试后主卡仍不完整，返回尽力结果');
    return normalize(lastParsed);
  }
  throw Object.assign(
    new Error('模型多次返回内容不完整或格式错误，换个模型或稍后重试'),
    { httpStatus: 502, rawContent: lastContent.slice(0, 500) }
  );
}

module.exports = { translate };
