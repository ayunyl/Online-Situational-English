/* ============================================================
   情景英语学习卡片 — app.js
   连接面板 + 动态渲染 + TTS 缓存 + 风格切换 + 生词模式
   ============================================================ */

const State = {
  llm: { connected: false, cfg: {} },
  tts: { connected: false, cfg: {} },
  wordDefs: {},
  phraseDefs: {},
  currentData: null,
  styles: {},         // { casual, formal, vlog, swagger, chill }
  activeStyle: 'casual',
  vocabMode: false,
  _styleChunkCache: {}  // 缓存 /api/analyze 返回的风格拆分
};

const $  = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));
const esc = (s) => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const pad2 = (n) => n < 10 ? '0' + n : '' + n;
const norm = (s) => s.toLowerCase().replace(/[^a-z]/g, '');

function look(raw) {
  const s = norm(raw);
  if (!s) return null;
  if (State.wordDefs[s]) return State.wordDefs[s];
  const c = new Set([s]);
  if (s.endsWith('s') && s.length > 3) c.add(s.slice(0, -1));
  if (s.endsWith('es') && s.length > 3) c.add(s.slice(0, -2));
  if (s.endsWith('ed') && s.length > 3) { c.add(s.slice(0, -2)); c.add(s.slice(0, -1)); }
  if (s.endsWith('ing') && s.length > 4) { c.add(s.slice(0, -3)); c.add(s.slice(0, -3) + 'e'); }
  if (s.endsWith('ies') && s.length > 4) c.add(s.slice(0, -3) + 'y');
  if (s.endsWith('ves') && s.length > 4) c.add(s.slice(0, -3) + 'f');
  for (const cc of c) if (State.wordDefs[cc]) return State.wordDefs[cc];
  return null;
}

// ────────────────────────────────────────
//  连接面板 → 设置弹窗
// ────────────────────────────────────────
$('#btnSettings').addEventListener('click', () => {
  $('#settingsModal').classList.add('show');
});
$('#settingsClose').addEventListener('click', () => {
  $('#settingsModal').classList.remove('show');
});
$('#settingsModal').addEventListener('click', (e) => {
  if (e.target === $('#settingsModal')) $('#settingsModal').classList.remove('show');
});
// 帮助按钮
$('#btnHelp').addEventListener('click', (e) => {
  e.stopPropagation();
  $('#helpPop').classList.toggle('show');
});
document.addEventListener('click', (e) => {
  if (!e.target.closest('#btnHelp') && !e.target.closest('#helpPop')) {
    $('#helpPop').classList.remove('show');
  }
});

function setStatus(el, ok, msg) {
  el.classList.remove('ok', 'err');
  el.classList.add(ok ? 'ok' : 'err');
  el.querySelector('.status-text').textContent = msg;
}

// ── 连接状态条更新 ──
function updateConnStatusBar() {
  const dot = document.getElementById('llmStatusDot');
  const text = document.getElementById('llmStatusText');
  if (!dot || !text) return;
  if (State.llm.connected) {
    dot.className = 'conn-dot ok';
    text.textContent = '已连接';
    text.className = 'conn-state';
    document.body.classList.add('llm-on');
  } else {
    dot.className = 'conn-dot';
    text.textContent = '未连接 · 点击设置';
    text.className = 'conn-state pending';
    document.body.classList.remove('llm-on');
  }
}

// ── 引导设置 LLM 提示（替代 alert）──
function showLlmGuide(action) {
  const mask = document.createElement('div');
  mask.className = 'guide-mask';
  mask.innerHTML =
    '<div class="guide-card">' +
    '<div class="guide-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>' +
    '<circle cx="12" cy="12" r="3"/></svg></div>' +
    '<h3>需要先连接 LLM</h3>' +
    '<p>' + (action || '翻译') + '功能需要 LLM 支持。<br>请先在设置里填入 API Key 并连接。</p>' +
    '<div class="guide-actions">' +
    '<button class="btn secondary" id="guideCancel">取消</button>' +
    '<button class="btn btn-action" id="guideGoSettings">去设置</button>' +
    '</div></div>';
  document.body.appendChild(mask);
  const close = () => mask.remove();
  mask.querySelector('#guideCancel').onclick = close;
  mask.querySelector('#guideGoSettings').onclick = () => { close(); $('#settingsModal').classList.add('show'); };
  mask.addEventListener('click', (e) => { if (e.target === mask) close(); });
}

// 状态条点击 → 打开设置
document.getElementById('connStatusBar').addEventListener('click', () => {
  $('#settingsModal').classList.add('show');
});
// 初始化状态条
updateConnStatusBar();

$('#btnTestLlm').addEventListener('click', async () => {
  const key = $('#llmKey').value.trim();
  const url = $('#llmUrl').value.trim();
  const model = $('#llmModel').value.trim();
  const el = $('#llmStatus');
  if (!key) { setStatus(el, false, '请填 API Key'); return; }
  setStatus(el, false, '连接中…');
  try {
    const res = await fetch('/api/translate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: '你好', llm: { apiKey: key, baseUrl: url, model } })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '连接测试失败');
    if (!data.full_en && !data.chunks) throw new Error('模型没有返回有效数据');
    State.llm.connected = true;
    State.llm.cfg = { key, url, model };
    setStatus(el, true, '连接成功');
    updateConnStatusBar();
  } catch (e) {
    State.llm.connected = false;
    setStatus(el, false, e.message.slice(0, 80));
    updateConnStatusBar();
  }
});

// ── 即将支持的服务商 ────────────────────────────────
// 选中这些时不发请求，显示"即将支持"提示；待实现时：
//   1. 在 providers/ 下新增 tts-xxx.js，导出 tts({ text, apiKey, baseUrl, voiceId, model })
//   2. 在 server/index.js 的 switch(provider) 中加 case
//   3. 将该 provider 从 PLANNED 移到上面的 TTS_FIELD_DEFS 中
const PLANNED_TTS = ['azure', 'minimax', 'aliyun', 'tencent', 'volcengine', 'xunfei'];
const PLANNED_NAMES = {'azure': 'Azure TTS', 'minimax': 'MiniMax（海螺）', 'aliyun': '阿里云 CosyVoice', 'tencent': '腾讯云 TTS', 'volcengine': '火山引擎（豆包）', 'xunfei': '科大讯飞'};
const TTS_FIELD_DEFS = {
  browser: [],
  elevenlabs: [
    { id: 'ttsKey', label: 'API Key', type: 'password', ph: 'xi-...' },
    { id: 'ttsVoice', label: 'Voice ID', type: 'text', ph: 'Xb7hH8MSUJpSbSDYk0k2', val: 'Xb7hH8MSUJpSbSDYk0k2' }
  ],
  openai: [
    { id: 'ttsKey', label: 'API Key', type: 'password', ph: 'sk-...' },
    { id: 'ttsVoice', label: 'Voice', type: 'text', ph: 'alloy', val: 'alloy' },
    { id: 'ttsModel', label: 'Model', type: 'text', ph: 'tts-1', val: 'tts-1' },
    { id: 'ttsBaseUrl', label: 'Base URL', type: 'text', ph: 'https://api.openai.com/v1' },
    { id: '_hint', text: '走 OpenAI 标准 /v1/audio/speech，兼容各类 OpenAI 兼容网关' }
  ],
  kokoro: [
    { id: '_hint', text: '内置 Kokoro TTS 引擎，音色与语速在下方面板设置' }
  ]
};

function renderTtsFields() {
  const provider = ($('#ttsProvider') || {}).value || 'browser';
  const def = TTS_FIELD_DEFS[provider] || [];
  let h = '';
  def.forEach(f => {
    if (f.id === '_hint') { h += '<div class="field-hint">' + f.text + '</div>'; return; }
    const val = f.val ? ' value="' + f.val + '"' : '';
    h += '<div class="conn-row"><label>' + f.label + '</label><input ' + (f.type || 'text') + ' id="' + f.id + '" placeholder="' + f.ph + '"' + val + '></div>';
  });
  $('#ttsFields').innerHTML = h;
  // 显示/隐藏"即将支持"占位（在 innerHTML 之后追加，避免被覆盖）
  const planned = PLANNED_TTS.includes(provider);
  if (planned) {
    const hint = document.createElement('div');
    hint.className = 'planned-hint';
    hint.textContent = '「' + (PLANNED_NAMES[provider] || provider) + '」即将支持，敬请期待';
    $('#ttsFields').appendChild(hint);
  }
  // Re-bind events
  $('#ttsFields').addEventListener('input', e => { if (e.target.tagName === 'INPUT') updateVoiceBadge(); });
}


function updateVoiceBadge() {
  const provider = ($('#ttsProvider') || {}).value || 'browser';
  const labels = { browser: '浏览器', elevenlabs: 'ElevenLabs', openai: 'OpenAI 兼容', kokoro: 'Kokoro' };
  const planned = PLANNED_TTS.includes(provider);
  const badge = $('#voiceBadge');
  const statusEl = $('#ttsStatus');
  if (provider === 'browser') {
    const uri = State.tts.cfg && State.tts.cfg.browserVoiceURI;
    const v = uri && window.speechSynthesis ? speechSynthesis.getVoices().find(x => x.voiceURI === uri) : null;
    badge.textContent = v ? '当前语音：浏览器 — ' + v.name + ' (' + v.lang + ')' : '当前语音：浏览器（自动选英式）';
    badge.className = 'voice-badge';
    if (statusEl) { statusEl.className = 'status ok'; statusEl.querySelector('.status-text').textContent = '浏览器（默认）'; }
  } else if (planned) {
    badge.textContent = '当前语音：' + (PLANNED_NAMES[provider] || provider) + '（即将支持）';
    badge.className = 'voice-badge';
    if (statusEl) { statusEl.className = 'status'; statusEl.querySelector('.status-text').textContent = '即将支持'; }
  } else if (provider === 'kokoro') {
    const voiceEl = document.getElementById('kokoroVoice');
    const speedEl = document.getElementById('kokoroSpeed');
    const vName = voiceEl ? (voiceEl.options[voiceEl.selectedIndex] || {}).text : '';
    const spd = speedEl ? parseFloat(speedEl.value).toFixed(1) : '1.0';
    badge.textContent = '当前语音：Kokoro — ' + (vName || 'af_alloy') + ' · ' + spd + '×';
    badge.className = 'voice-badge active';
    if (statusEl) { statusEl.className = 'status'; statusEl.querySelector('.status-text').textContent = 'Kokoro（内置）'; }
  } else {
    const key = ($('#ttsKey') || {}).value || '';
    const cfg = State.tts.cfg || {};
    if (key || cfg.key) {
      badge.textContent = '当前语音：' + (labels[provider] || provider);
      badge.className = 'voice-badge active';
    } else {
      badge.textContent = '当前语音：' + (labels[provider] || provider) + '（未填 key，将回退浏览器）';
      badge.className = 'voice-badge';
    }
    if (statusEl) { statusEl.className = statusEl.className; statusEl.querySelector('.status-text').textContent = (key || cfg.key) ? '已填 key' : '未填 key'; }
  }
}

$('#ttsProvider').addEventListener('change', function () {
  updateVoiceBadge();
  renderTtsFields();
  populateVoicePanel();
  toggleKokoroPanel();
});
// 初始加载渲染（浏览器为默认档时立刻显示音色下拉）
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { renderTtsFields(); populateVoicePanel(); toggleKokoroPanel(); });
else { renderTtsFields(); populateVoicePanel(); toggleKokoroPanel(); }
$('#ttsKey') && $('#ttsKey').addEventListener('input', updateVoiceBadge);

// Kokoro 悬浮按钮显隐
function toggleKokoroPanel() {
  const provider = ($('#ttsProvider') || {}).value || 'browser';
  const stack = document.getElementById('rightFabStack');
  const pop = document.getElementById('kokoroPop');
  if (!stack) return;
  if (provider === 'kokoro') stack.classList.add('show');
  else { stack.classList.remove('show'); if (pop) pop.classList.remove('show'); }
}
// 语速滑块实时显示
(function () {
  const slider = document.getElementById('kokoroSpeed');
  const label = document.getElementById('kokoroSpeedVal');
  if (slider && label) slider.addEventListener('input', function () { label.textContent = parseFloat(this.value).toFixed(1) + '×'; });
})();
// 语速箭头微调
(function () {
  const slider = document.getElementById('kokoroSpeed');
  const label = document.getElementById('kokoroSpeedVal');
  const down = document.getElementById('kokoroSpeedDown');
  const up = document.getElementById('kokoroSpeedUp');
  function nudge(delta) {
    if (!slider || !label) return;
    let v = parseFloat(slider.value) + delta;
    v = Math.max(0.5, Math.min(2, Math.round(v * 10) / 10));
    slider.value = v;
    label.textContent = v.toFixed(1) + '×';
  }
  if (down) down.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); nudge(-0.1); });
  if (up) up.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); nudge(0.1); });
})();
// Kokoro 音色变化时同步连接面板 badge
(function () {
  const sel = document.getElementById('kokoroVoice');
  if (sel) sel.addEventListener('change', updateVoiceBadge);
})();
// Kokoro 悬浮按钮点击 → 展开/收起，默认出现在按钮上方
if (document.getElementById('kokoroFab')) {
  document.getElementById('kokoroFab').addEventListener('click', function (e) {
    e.stopPropagation();
    const pop = document.getElementById('kokoroPop');
    if (!pop) return;
    if (pop.classList.contains('show')) { pop.classList.remove('show'); return; }
    // 计算位置：面板底部对齐按钮顶部，水平居中于按钮
    const fabRect = this.getBoundingClientRect();
    pop.style.visibility = 'hidden';
    pop.classList.add('show');
    const popRect = pop.getBoundingClientRect();
    let left = fabRect.left + fabRect.width / 2 - popRect.width / 2;
    let top = fabRect.top - popRect.height - 8;
    // 边界检查
    left = Math.max(8, Math.min(left, window.innerWidth - popRect.width - 8));
    if (top < 8) top = fabRect.bottom + 8; // 上方空间不够则放下方
    pop.style.left = left + 'px';
    pop.style.top = top + 'px';
    pop.style.visibility = '';
  });
}
// Kokoro 面板拖动
(function () {
  const pop = document.getElementById('kokoroPop');
  if (!pop) return;
  const hdr = pop.querySelector('.kokoro-pop-hdr');
  if (!hdr) return;
  let dragging = false, sx, sy, ox, oy;
  hdr.addEventListener('mousedown', function (e) {
    // 点关闭按钮不拖动
    if (e.target.closest('.kokoro-pop-close')) return;
    dragging = true;
    const r = pop.getBoundingClientRect();
    sx = e.clientX; sy = e.clientY;
    ox = r.left; oy = r.top;
    e.preventDefault();
  });
  document.addEventListener('mousemove', function (e) {
    if (!dragging) return;
    let nx = ox + (e.clientX - sx);
    let ny = oy + (e.clientY - sy);
    // 不拖出视口
    const pw = pop.offsetWidth, ph = pop.offsetHeight;
    nx = Math.max(0, Math.min(nx, window.innerWidth - pw));
    ny = Math.max(0, Math.min(ny, window.innerHeight - ph));
    pop.style.left = nx + 'px';
    pop.style.top = ny + 'px';
  });
  document.addEventListener('mouseup', function () { dragging = false; });
})();
// Kokoro 关闭按钮
if (document.getElementById('kokoroClose')) {
  document.getElementById('kokoroClose').addEventListener('click', function () {
    const pop = document.getElementById('kokoroPop');
    if (pop) pop.classList.remove('show');
  });
}
// 点击外部收起 Kokoro 面板
document.addEventListener('click', function (e) {
  const pop = document.getElementById('kokoroPop');
  const fab = document.getElementById('kokoroFab');
  if (pop && fab && pop.classList.contains('show') && !pop.contains(e.target) && !fab.contains(e.target)) {
    pop.classList.remove('show');
  }
});

$('#btnTestTts').addEventListener('click', async () => {
  const provider = $('#ttsProvider').value || 'browser';
  if (PLANNED_TTS.includes(provider)) {
    const el = $('#ttsStatus');
    setStatus(el, false, '即将支持，敬请期待');
    return;
  }
  const key = (($('#ttsKey') || {}).value || '').trim();
  const model = (($('#ttsModel') || {}).value || '').trim();
  const baseUrl = (($('#ttsBaseUrl') || {}).value || '').trim();
  // Kokoro 音色从独立面板下拉读取
  const kokoroVoiceEl = document.getElementById('kokoroVoice');
  const kokoroSpeedEl = document.getElementById('kokoroSpeed');
  const voice = (provider === 'kokoro' && kokoroVoiceEl) ? kokoroVoiceEl.value : (($('#ttsVoice') || {}).value || '').trim();
  const speed = (provider === 'kokoro' && kokoroSpeedEl) ? parseFloat(kokoroSpeedEl.value) : 1.0;
  const el = $('#ttsStatus');

  if (provider === 'browser') { setStatus(el, true, '浏览器可用'); return; }
  // Kokoro 和其他云服务统一走 /api/tts 测试
  // Kokoro 是内置引擎，不需要 API key
  if (provider === 'kokoro') {
    setStatus(el, false, '引擎加载中…');
    try {
      const res = await fetch('/api/tts', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'Hi there.', provider: 'kokoro', tts: { voiceId: voice || 'af_nicole', speed: speed || 1.0 } })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '合成测试失败');
      if (!data.audioBase64) throw new Error('没有返回音频文件');
      State.tts.cfg = { key: 'local', voiceId: voice, provider, speed };
      updateVoiceBadge();
      setStatus(el, true, '连接成功');
    } catch (e) {
      State.tts.cfg = null;
      setStatus(el, false, e.message.slice(0, 80));
    }
    return;
  }
  if (!key) { setStatus(el, false, '请填 API Key'); return; }
  setStatus(el, false, '连接中…');
  try {
    const res = await fetch('/api/tts', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'Hi there.', provider, tts: { apiKey: key, voiceId: voice, model, baseUrl } })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '合成测试失败');
    if (!data.audioBase64) throw new Error('没有返回音频文件');
    State.tts.cfg = { key, voiceId: voice, provider, baseUrl, model };
    updateVoiceBadge();
    setStatus(el, true, '连接成功');
  } catch (e) {
    State.tts.cfg = null;
    setStatus(el, false, e.message.slice(0, 80));
  }
});

// ────────────────────────────────────────
//  内置示例卡片（首页展示，无需 LLM 连接）
// ────────────────────────────────────────
const DEMO_CARD = {
  full_en: 'I love you, honey.',
  chunks: [
    {
      en: 'I love you, honey.',
      cn: '我爱你，亲爱的',
      tokens: [
        { w: 'I', ipa: '/aɪ/' },
        { w: 'love', ipa: '/lʌv/' },
        { w: 'you,', ipa: '/juː/' },
        { w: 'honey.', ipa: '/ˈhʌni/' }
      ],
      collocations: ['love you']
    }
  ],
  style_chunks: {
    formal: [
      {
        en: 'I love you, darling.',
        cn: '我爱你，亲爱的',
        tokens: [
          { w: 'I', ipa: '/aɪ/' },
          { w: 'love', ipa: '/lʌv/' },
          { w: 'you,', ipa: '/juː/' },
          { w: 'darling.', ipa: '/ˈdɑːlɪŋ/' }
        ],
        collocations: ['love you']
      }
    ],
    vlog: [
      {
        en: 'Hey guys, I just wanna say, I love you, honey, you know?',
        cn: '嘿大家，我就是想说，我爱你，亲爱的，你懂吧？',
        tokens: [
          { w: 'Hey', ipa: '/heɪ/' },
          { w: 'guys,', ipa: '/ɡaɪz/' },
          { w: 'I', ipa: '/aɪ/' },
          { w: 'just', ipa: '/dʒʌst/' },
          { w: 'wanna', ipa: '/ˈwɒnə/' },
          { w: 'say,', ipa: '/seɪ/' },
          { w: 'I', ipa: '/aɪ/' },
          { w: 'love', ipa: '/lʌv/' },
          { w: 'you,', ipa: '/juː/' },
          { w: 'honey,', ipa: '/ˈhʌni/' },
          { w: 'you', ipa: '/juː/' },
          { w: 'know?', ipa: '/nəʊ/' }
        ],
        collocations: ['wanna say', 'love you']
      }
    ],
    swagger: [
      {
        en: 'I love you, babe. For real.',
        cn: '我爱你，宝贝。说真的。',
        tokens: [
          { w: 'I', ipa: '/aɪ/' },
          { w: 'love', ipa: '/lʌv/' },
          { w: 'you,', ipa: '/juː/' },
          { w: 'babe.', ipa: '/beɪb/' },
          { w: 'For', ipa: '/fɔː/' },
          { w: 'real.', ipa: '/ˈrɪəl/' }
        ],
        collocations: ['love you', 'for real']
      }
    ],
    chill: [
      {
        en: "Love you, honey. That's it.",
        cn: '爱你，亲爱的。就这样。',
        tokens: [
          { w: 'Love', ipa: '/lʌv/' },
          { w: 'you,', ipa: '/juː/' },
          { w: 'honey.', ipa: '/ˈhʌni/' },
          { w: "That's", ipa: '/ðæts/' },
          { w: 'it.', ipa: '/ɪt/' }
        ],
        collocations: ['love you', "that's it"]
      }
    ]
  },
  word_defs: {
    i: '我（主格）',
    love: '爱、喜爱',
    you: '你',
    honey: '亲爱的、宝贝（口语爱称）',
    darling: '亲爱的（较正式爱称）',
    hey: '嘿、打招呼',
    guys: '大家、伙计们（口语）',
    just: '只是、就',
    wanna: '想要（= want to，口语缩略）',
    say: '说、讲',
    know: '知道、懂',
    babe: '宝贝（口语爱称）',
    for: '为了',
    real: '真实的、真的',
    that: '那',
    it: '它'
  },
  phrase_defs: {
    'love you': '爱你（口语缩略，= I love you）',
    'wanna say': '想说（口语，= want to say）',
    'for real': '说真的、不开玩笑（口语强调）',
    "that's it": '就这样、没别的'
  },
  styles: {
    casual: 'I love you, honey.',
    formal: 'I love you, darling.',
    vlog: 'Hey guys, I just wanna say, I love you, honey, you know?',
    swagger: 'I love you, babe. For real.',
    chill: "Love you, honey. That's it."
  },
  collocation_notes: [
    { phrase: 'love you', note: '口语中常省略主语 I，直接说 Love you 表达爱意。' },
    { phrase: 'for real', note: '口语强调词组，意为"说真的、不开玩笑"，常放句末加强语气。' },
    { phrase: "that's it", note: '常用口语结尾，意为"就这样、没别的"，表简洁收尾。' }
  ]
};

// ────────────────────────────────────────
//  语言自动检测 + Kokoro 音色自动匹配
//  当文本语言与当前选中音色语言不一致时，
//  自动临时切换到该语言的默认音色（不改 UI 下拉框）
// ────────────────────────────────────────
function detectLang(text) {
  if (!text) return 'en';
  if (/[\u3040-\u309f\u30a0-\u30ff]/.test(text)) return 'ja';   // 平假名/片假名 → 日语
  if (/[\u4e00-\u9fff\u3400-\u4dbf]/.test(text)) return 'zh';   // 汉字 → 中文
  return 'en';
}
// Kokoro 各非英文语言的默认音色（英文沿用用户当前选择）
const KOKORO_DEFAULT_BY_LANG = {
  zh: 'zf_xiaoxiao',   // 笑笑（女声）
  ja: 'jf_alpha'       // Alpha（女声）
};
// 根据 Kokoro 音色 ID 前缀判断语言
function kokoroVoiceLang(vid) {
  if (!vid) return 'en';
  return ({ a:'en', b:'en', z:'zh', j:'ja' })[vid.charAt(0).toLowerCase()] || 'en';
}
// 根据文本语言自动匹配 Kokoro 音色：
//   用户选的音色语言与文本一致 → 用用户选的
//   不一致 → 用该语言的默认音色（UI 下拉框不变，仅本次调用切换）
function resolveKokoroVoice(text) {
  const sel = document.getElementById('kokoroVoice');
  const userVoice = sel ? sel.value : 'af_nicole';
  const userLang = kokoroVoiceLang(userVoice);
  const textLang = detectLang(text);
  if (userLang === textLang) return userVoice;
  return KOKORO_DEFAULT_BY_LANG[textLang] || userVoice;
}

// ────────────────────────────────────────
//  生成卡片
// ────────────────────────────────────────
$('#btnGenerate').addEventListener('click', async () => {
  const text = $('#inputText').value.trim();
  if (!text) { alert('请先输入内容。'); return; }
  if (!State.llm.connected) { showLlmGuide('翻译'); return; }
  const btn = $('#btnGenerate');
  btn.textContent = '生成中…'; btn.disabled = true;
  // 立即显示加载状态：呼吸点 + 模型生成中（不显示任何按钮）
  $('#cardContent').innerHTML =
    '<div class="style-bar" id="styleBar"><span class="style-pending-dot"></span></div>'
    + '<div class="chunks-loading"><div class="loading-dots"><span></span><span></span><span></span></div><p>模型生成中…</p></div>';
  // 分阶段等待提示（放在翻译按钮左侧）
  const hintTimers = [];
  hintTimers.push(setTimeout(() => {
    const hint = document.createElement('div');
    hint.className = 'loading-hint';
    hint.id = 'translateLoadingHint';
    hint.textContent = '模型太菜';
    btn.parentNode.insertBefore(hint, btn);
  }, 10000));
  hintTimers.push(setTimeout(() => {
    const hint = document.getElementById('translateLoadingHint');
    if (hint) hint.textContent = '别急';
  }, 30000));
  hintTimers.push(setTimeout(() => {
    const hint = document.getElementById('translateLoadingHint');
    if (hint) hint.textContent = '快了快了';
  }, 60000));
  try {
    const res = await fetch('/api/translate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
        llm: { apiKey: State.llm.cfg.key, baseUrl: State.llm.cfg.url, model: State.llm.cfg.model }
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '翻译出错了');
    // LLM 未返回 chunks 时，客户端兜底拆分
    if (!data.chunks || !Array.isArray(data.chunks) || data.chunks.length === 0) {
      if (data.full_en) {
        data.chunks = rechunkText(data.full_en, data);
      }
      if (!data.chunks || data.chunks.length === 0) {
        throw new Error('模型返回的数据不完整，换一个模型试试');
      }
    }
    State.currentData = data;
    State.wordDefs = data.word_defs || {};
    State.phraseDefs = data.phrase_defs || {};
    State.styles = data.styles || {};
    if (data.full_en) State.styles.casual = data.full_en;
    State.activeStyle = 'casual';
    TTS.clearCache();
    State._styleChunkCache = {};
    renderCard(data);
    // 后台预加载非日常风格的拆分
    preloadStyleChunks(data);
  } catch (e) {
    alert('生成失败：' + e.message);
  } finally {
    hintTimers.forEach(clearTimeout);
    const hintEl = document.getElementById('translateLoadingHint');
    if (hintEl) hintEl.remove();
    btn.textContent = '翻译'; btn.disabled = false;
  }
});

// ────────────────────────────────────────
//  客户端重新拆分 — 风格切换时用
//  从原数据继承 IPA 音标和固定搭配
// ────────────────────────────────────────
function rechunkText(text, originalData) {
  if (!text) return [];

  // 建立 word → IPA 映射（从原始 tokens）
  const ipaMap = {};
  if (originalData && Array.isArray(originalData.chunks)) {
    originalData.chunks.forEach(chunk => {
      (chunk.tokens || []).forEach(tok => {
        const w = norm(tok.w || '');
        if (w && tok.ipa && !ipaMap[w]) ipaMap[w] = tok.ipa;
      });
    });
  }

  // 收集所有固定搭配
  const allCollocations = [];
  if (originalData && Array.isArray(originalData.chunks)) {
    originalData.chunks.forEach(chunk => {
      (chunk.collocations || []).forEach(col => {
        if (!allCollocations.includes(col)) allCollocations.push(col);
      });
    });
  }

  // 按标点切分意群（保留标点在前一段）
  const segments = text.match(/[^,.;:!?—]+[,.;:!?—]*/g) || [text];
  const chunkTexts = segments.map(s => s.trim()).filter(Boolean);

  return chunkTexts.map(chunkText => {
    const words = chunkText.split(/\s+/).filter(Boolean);
    const tokens = words.map(w => ({ w, ipa: ipaMap[norm(w)] || '' }));

    // 匹配固定搭配
    const chunkCollocations = [];
    allCollocations.forEach(col => {
      const colParts = col.split(' ').map(norm);
      for (let s = 0; s + colParts.length <= words.length; s++) {
        let hit = true;
        for (let j = 0; j < colParts.length; j++) {
          if (norm(words[s + j]) !== colParts[j]) { hit = false; break; }
        }
        if (hit) {
          if (!chunkCollocations.includes(col)) chunkCollocations.push(col);
          break;
        }
      }
    });

    return { en: chunkText, cn: '', tokens, collocations: chunkCollocations, incomplete: true };
  });
}

// ── 验证意群完整性 ───────────────────────
// 检查一组 chunks 是否全部包含音标和中文翻译
function validateChunks(chunks) {
  if (!Array.isArray(chunks) || chunks.length === 0) return false;
  return chunks.every(c => {
    if (c.incomplete) return false;
    if (!c.cn || !c.cn.trim()) return false;
    if (!Array.isArray(c.tokens) || c.tokens.length === 0) return false;
    return c.tokens.every(t => t.ipa && t.ipa.trim());
  });
}

// 调 /api/analyze 并自动重试：应对限流(429)/服务端过载(5xx)/网络抖动。
// 返回解析后的 aData；最终仍失败则返回 null。这样并发被打回的风格也会退避后重发，不会永久卡在加载中。
function fetchAnalyzeChunks(text, llmCfg, maxRetries) {
  maxRetries = (maxRetries == null) ? 2 : maxRetries;
  const llm = llmCfg || (State.llm && State.llm.cfg) || {};
  const body = { text, llm: { apiKey: llm.key, baseUrl: llm.url, model: llm.model } };
  function attempt(n) {
    return fetch('/api/analyze', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
      .then(res => {
        // 限流 / 服务端过载 → 退避后重试
        if (res.status === 429 || res.status >= 500) {
          if (n < maxRetries) {
            return new Promise(r => setTimeout(r, 700 * (n + 1))).then(() => attempt(n + 1));
          }
          console.warn('[analyze] 重试耗尽，状态码', res.status);
          return null;
        }
        if (!res.ok) return null;
        return res.json();
      })
      .then(aData => (aData && aData.error) ? null : (aData || null))
      .catch(e => {
        if (n < maxRetries) {
          return new Promise(r => setTimeout(r, 700 * (n + 1))).then(() => attempt(n + 1));
        }
        console.warn('[analyze] 请求异常，重试耗尽', e && e.message);
        return null;
      });
  }
  return attempt(0);
}

// 主卡（日常）残缺时的后台兜底：用 /api/analyze 对整段英文重新拆分补全
function ensureMainChunks() {
  if (State._loadingMain) return;
  if (!State.llm || !State.llm.connected || !State.currentData) return;
  const text = State.currentData.full_en || '';
  if (!text) return;
  State._loadingMain = true;
  fetchAnalyzeChunks(text, State.llm.cfg).then(a => {
    State._loadingMain = false;
    if (!a || !a.chunks || !validateChunks(a.chunks)) return;
    if (State.currentData) {
      State.currentData.chunks = a.chunks;
      Object.assign(State.wordDefs, a.word_defs || {});
    }
    if (!State._styleChunkCache) State._styleChunkCache = {};
    State._styleChunkCache.casual = a.chunks;
    if (State.currentData) renderCard(State.currentData);
  });
}


// ────────────────────────────────────────
//  渲染
// ────────────────────────────────────────
function renderCard(data) {
  const root = $('#cardContent');
  let html = '';

  // Styles available
  const styleKeys = State.styles && Object.keys(State.styles).length
    ? Object.keys(State.styles) : ['casual', 'formal', 'vlog', 'swagger', 'chill'];
  // 默认选第一个风格（通常 casual）
  let activeStyle = State.activeStyle;
  if (!activeStyle || !styleKeys.includes(activeStyle)) {
    activeStyle = styleKeys[0] || 'casual';
  }
  State.activeStyle = activeStyle;

  const currentText = (State.styles && State.styles[activeStyle])
    ? State.styles[activeStyle] : (data.full_en || '');

  // 如果当前风格文本与 full_en 不同，选择最佳拆分
  let chunks = data.chunks || [];
  let chunksLoading = false;
  function pickStyleChunks(style) {
    if (data.style_chunks && data.style_chunks[style] && validateChunks(data.style_chunks[style])) return data.style_chunks[style];
    if (State._styleChunkCache && State._styleChunkCache[style] && validateChunks(State._styleChunkCache[style])) return State._styleChunkCache[style];
    return null;
  }
  if (currentText !== data.full_en) {
    const sc = pickStyleChunks(activeStyle);
    if (sc) {
      chunks = sc;
    } else {
      // 数据未就绪：不展示残缺数据，显示加载状态
      chunks = [];
      chunksLoading = true;
    }
  } else {
    // 主卡（日常）也必须三行齐全才展示，残缺则显示加载并后台补全
    if (validateChunks(data.chunks)) {
      chunks = data.chunks;
    } else {
      chunks = [];
      chunksLoading = true;
      ensureMainChunks();
    }
  }
  const renderData = { ...data, chunks, full_en: currentText };

  // Style buttons — 只显示已有数据的风格，未加载的用呼吸点代替
  const labels = { casual: '日常', formal: '正式', vlog: 'Vlog', swagger: '嚣张', chill: '松弛' };
  // 判断每个风格是否有有效数据
  function hasStyleData(k) {
    if (k === 'casual') return true; // 日常总是有数据（来自 translate 响应）
    if (data.style_chunks && data.style_chunks[k] && validateChunks(data.style_chunks[k])) return true;
    if (State._styleChunkCache && State._styleChunkCache[k] && validateChunks(State._styleChunkCache[k])) return true;
    return false;
  }
  const readyStyles = styleKeys.filter(hasStyleData);
  const pendingCount = styleKeys.length - readyStyles.length;
  // 如果当前选中的风格还没数据，回退到第一个可用的
  if (!readyStyles.includes(activeStyle)) {
    activeStyle = readyStyles[0] || 'casual';
    State.activeStyle = activeStyle;
  }
  html += '<div class="style-bar" id="styleBar">';
  readyStyles.forEach(k => {
    let cls = 'style-btn';
    if (k === activeStyle) cls += ' active';
    html += '<button class="' + cls + '" data-style="' + k + '">' + (labels[k] || k) + '</button>';
  });
  if (pendingCount > 0) {
    html += '<span class="style-pending-dot" title="' + pendingCount + '个风格加载中"></span>';
  }
  html += '</div>';

  // Overview with play button (absolute positioned, no separate row)
  html += '<div class="overview">'
    + '<button class="play-btn play-full" data-say="' + esc(currentText) + '" aria-label="朗读整段英文">'
    + '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>'
    + '</button>'
    + '<div class="full-en" contenteditable="true" id="fullEnText" spellcheck="false">' + esc(currentText) + '</div>'
    + '</div>';

  // Chunks
  if (chunksLoading) {
    html += '<div class="chunks-loading">'
      + '<div class="loading-dots"><span></span><span></span><span></span></div>'
      + '<p>模型生成中…</p>'
      + '</div>';
  } else {
    chunks.forEach((chunk, i) => {
      const en = chunk.en || '';
      const cn = chunk.cn || '';
      const toks = chunk.tokens || [];
      let toksHtml = toks.map(tok => {
        const w = tok.w || '';
        return '<span class="tok">'
          + '<span class="word" data-w="' + esc(norm(w)) + '">' + esc(w) + '</span>'
          + '<span class="ipa">' + esc(tok.ipa || '') + '</span>'
          + '</span>';
      }).join('');
      html += '<div class="chunk" data-ci="' + i + '">'
        + '<span class="chunk-num-dot">' + (i + 1) + '</span>'
        + '<button class="play-btn" data-say="' + esc(en) + '" aria-label="朗读这句">'
        + '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>'
        + '</button>'
        + '<div class="line">' + toksHtml + '</div>'
        + (cn ? '<div class="zh">' + esc(cn) + '</div>' : '')
        + '</div>';
    });
  }

  root.innerHTML = html;
  decorateAndBind(renderData);
}

// ────────────────────────────────────────
//  装饰交互
// ────────────────────────────────────────
function decorateAndBind(data) {
  const root = $('#cardContent');
  const chunkEls = root.querySelectorAll('.chunk');
  data.chunks.forEach((chunk, ci) => {
    const chunkEl = chunkEls[ci];
    if (!chunkEl) return;
    const wordEls = chunkEl.querySelectorAll('.word');
    const tokens = chunk.tokens || [];
    const collocations = chunk.collocations || [];
    const idxToPhrase = {};
    collocations.forEach(col => {
      const parts = col.split(' ').map(norm);
      for (let s = 0; s + parts.length <= tokens.length; s++) {
        let hit = true;
        for (let j = 0; j < parts.length; j++) {
          if (norm(tokens[s + j].w) !== parts[j]) { hit = false; break; }
        }
        if (hit) for (let j = 0; j < parts.length; j++) idxToPhrase[s + j] = col;
      }
    });
    wordEls.forEach((w, idx) => {
      if (idxToPhrase[idx]) {
        w.classList.add('collo');
        w.dataset.phrase = idxToPhrase[idx];
        w.dataset.phrasedef = State.phraseDefs[idxToPhrase[idx]] || '';
      }
    });
  });
  bindTooltips();
  bindPlayButtons();
  wireFullText();
  wireStyleSwitcher();

  // ── 自动预合成：卡片渲染后后台批量抓取所有句子音频 ──
  prefetchAllAudio();
}

// ────────────────────────────────────────
//  悬停释义
// ────────────────────────────────────────
const tip = $('#tip');

// ────────────────────────────────────────
//  自动预合成：卡片渲染后后台批量抓取所有句子音频
//  用户点播放时直接从缓存播放，不用等
// ────────────────────────────────────────
function prefetchAllAudio() {
  const provider = ($('#ttsProvider') || {}).value || 'browser';
  if (provider === 'browser') return; // 浏览器 TTS 不需要预合成

  // 收集所有需要合成的句子
  const sentences = [];
  document.querySelectorAll('.play-btn[data-say]').forEach(btn => {
    const text = btn.getAttribute('data-say') || '';
    if (!text) return;
    const voiceId = (provider === 'kokoro') ? resolveKokoroVoice(text) : (($('#ttsVoice') || {}).value || 'default');
    const cacheKey = voiceId + '@' + provider;
    if (!TTS._cacheGet(text, cacheKey)) {
      sentences.push({ text, voiceId, provider });
    }
  });

  // 没有需要预合成的
  if (sentences.length === 0) return;

  // 在状态条显示"正在预合成..."
  const ttsStatusText = $('#ttsStatusText');
  const originalText = ttsStatusText ? ttsStatusText.textContent : '';
  if (ttsStatusText) ttsStatusText.textContent = '预合成中...';

  const key = ($('#ttsKey') || {}).value || '';
  const baseUrl = ($('#ttsBaseUrl') || {}).value || '';
  const model = ($('#ttsModel') || {}).value || '';
  const kokoroSpeedEl = document.getElementById('kokoroSpeed');
  const speed = (provider === 'kokoro' && kokoroSpeedEl) ? parseFloat(kokoroSpeedEl.value) : 1.0;

  // 并行抓取（最多 3 个同时，避免服务器过载）
  const CONCURRENCY = 3;
  let index = 0;
  let done = 0;

  async function fetchOne(item) {
    const body = {
      text: item.text,
      provider: item.provider,
      tts: { apiKey: key, voiceId: item.voiceId, baseUrl, model, speed }
    };
    try {
      const res = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const data = await res.json();
      if (data.audioBase64) {
        TTS._cacheSet(item.text, item.voiceId + '@' + item.provider, {
          b64: data.audioBase64,
          mime: data.mime || 'audio/wav'
        });
      }
    } catch (e) {
      console.log('[预合成] 失败:', item.text.substring(0, 30), e.message);
    }
    done++;
    if (ttsStatusText) {
      ttsStatusText.textContent = '预合成 ' + done + '/' + sentences.length;
    }
  }

  async function runPool() {
    const workers = [];
    for (let w = 0; w < CONCURRENCY; w++) {
      workers.push((async () => {
        while (index < sentences.length) {
          const item = sentences[index++];
          await fetchOne(item);
        }
      })());
    }
    await Promise.all(workers);
    if (ttsStatusText) {
      ttsStatusText.textContent = originalText || 'Kokoro 就绪';
    }
  }

  runPool(); // 后台执行，不阻塞 UI
}
function showTip(w, x, y) {
  const wc = w.dataset.w || norm(w.textContent);
  const def = look(wc);
  const raw = w.textContent.replace(/[.,—]/g, '');
  let html = '<span class="t-word">' + raw + '</span>' + (def || '（暂无释义）');
  if (w.dataset.phrase && w.dataset.phrasedef) {
    html += '<div class="t-phrase">词组 <b>' + w.dataset.phrase + '</b>：' + w.dataset.phrasedef + '</div>';
  }
  tip.innerHTML = html;
  tip.classList.add('show');
  const r = tip.getBoundingClientRect();
  const left = Math.min(Math.max(8, x - r.width / 2), window.innerWidth - r.width - 8);
  let top = y - r.height - 12;
  if (top < 8) top = y + 20;
  tip.style.left = left + 'px';
  tip.style.top = top + 'px';
}
function hideTip() { tip.classList.remove('show'); }

function bindTooltips() {
  $$('.word').forEach(w => {
    w.addEventListener('click', function () {
      if (State.vocabMode) {
        w.classList.toggle('marked');
        const tok = w.closest('.tok');
        if (w.classList.contains('marked')) {
          const cn = State.wordDefs[w.dataset.w] || '';
          w.dataset.cn = cn;
          // 在 .tok 顶部插入中文标注
          let cnSpan = tok.querySelector('.word-cn');
          if (!cnSpan) {
            cnSpan = document.createElement('span');
            cnSpan.className = 'word-cn';
            tok.insertBefore(cnSpan, tok.firstChild);
          }
          cnSpan.textContent = cn;
        } else {
          const cnSpan = tok.querySelector('.word-cn');
          if (cnSpan) cnSpan.remove();
        }
      } else {
        // 非生词模式：朗读该单词
        const wordText = w.textContent.trim();
        if (wordText) TTS.speak(null, wordText);
      }
    });
    w.addEventListener('mouseenter', function (e) {
      const r = w.getBoundingClientRect();
      showTip(w, r.left + r.width / 2, r.top);
    });
    w.addEventListener('mouseleave', hideTip);
  });
}

// ────────────────────────────────────────
//  风格切换 — 切换风格时重新渲染卡片，
//  拆分内容自动对齐当前风格英文
//  优先使用预定义 style_chunks / 缓存，否则客户端兜底拆分
// ────────────────────────────────────────
function wireStyleSwitcher() {
  document.querySelectorAll('.style-btn').forEach(btn => {
    btn.addEventListener('click', function () {
      const style = btn.dataset.style;
      if (!State.styles[style]) return;
      State.activeStyle = style;
      TTS.stop();
      renderCard(State.currentData);
      // 如果该风格数据未就绪且未在加载中，立即触发加载（跳过批次排队）
      const data = State.currentData;
      if (data && style !== 'casual' && State.styles[style] !== data.full_en) {
        const hasValid = (data.style_chunks && data.style_chunks[style] && validateChunks(data.style_chunks[style]))
          || (State._styleChunkCache && State._styleChunkCache[style] && validateChunks(State._styleChunkCache[style]));
        const isLoading = State._loadingStyles && State._loadingStyles.has(style);
        if (!hasValid && !isLoading && State.llm.connected) {
          if (!State._loadingStyles) State._loadingStyles = new Set();
          State._loadingStyles.add(style);
          fetchAnalyzeChunks(State.styles[style], State.llm.cfg).then(aData => {
            State._loadingStyles.delete(style);
            if (!aData || !aData.chunks || !validateChunks(aData.chunks)) return;
            if (!State._styleChunkCache) State._styleChunkCache = {};
            State._styleChunkCache[style] = aData.chunks;
            Object.assign(State.wordDefs, aData.word_defs || {});
            Object.assign(State.phraseDefs, aData.phrase_defs || {});
            if (State.activeStyle === style && State.currentData) {
              renderCard(State.currentData);
            }
          });
        }
      }
    });
  });
}

// ────────────────────────────────────────
//  contenteditable + Split
// ────────────────────────────────────────
function wireFullText() {
  const fullEl = document.getElementById('fullEnText');
  if (!fullEl) return;
  // 用户改英文 → 更新耳机按钮的 data-say
  fullEl.addEventListener('input', function () {
    document.querySelectorAll('.play-full').forEach(b => b.dataset.say = fullEl.innerText.trim());
  });
}

// ────────────────────────────────────────
//  后台预加载非日常风格的拆分（IPA + 中文）
//  当 LLM 返回的 style_chunks 缺失时，
//  静默调用 /api/analyze 逐个风格补全，缓存到 _styleChunkCache
// ────────────────────────────────────────
function preloadStyleChunks(data) {
  if (!State.llm.connected || !State.styles) return;
  const allStyles = Object.keys(State.styles);
  if (!State._loadingStyles) State._loadingStyles = new Set();

  function loadStyle(style) {
    const styleText = State.styles[style];
    if (!styleText || styleText === data.full_en) return;
    if (data.style_chunks && data.style_chunks[style] && validateChunks(data.style_chunks[style])) return;
    if (State._styleChunkCache && State._styleChunkCache[style] && validateChunks(State._styleChunkCache[style])) return;
    if (State._loadingStyles.has(style)) return;
    State._loadingStyles.add(style);
    // 如果用户正在查看该风格，刷新显示加载状态
    if (State.activeStyle === style && State.currentData) {
      renderCard(State.currentData);
    }
    fetchAnalyzeChunks(styleText, State.llm.cfg).then(aData => {
      State._loadingStyles.delete(style);
      if (!aData || !aData.chunks || !validateChunks(aData.chunks)) return;
      if (!State._styleChunkCache) State._styleChunkCache = {};
      State._styleChunkCache[style] = aData.chunks;
      Object.assign(State.wordDefs, aData.word_defs || {});
      Object.assign(State.phraseDefs, aData.phrase_defs || {});
      // 任一风格加载完都刷新按钮栏，让新按钮出现
      if (State.currentData) renderCard(State.currentData);
    });
  }

  // 全部并行：每个风格一个独立小请求，谁先回来谁先点亮（casual 因等于 full_en 会被 loadStyle 自动跳过）
  allStyles.map(loadStyle);
}

document.addEventListener('click', function (e) {
  if (!e.target.closest('#btnSplit')) return;
  const fullEl = document.getElementById('fullEnText');
  if (!fullEl) return;
  const text = fullEl.innerText.trim();
  if (!text) { alert('请先写入英文。'); return; }
  if (!State.llm.connected) { showLlmGuide('拆分'); return; }
  const btn = e.target.closest('#btnSplit');
  btn.disabled = true; btn.classList.add('loading');
  fetch('/api/analyze', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text,
      llm: { apiKey: State.llm.cfg.key, baseUrl: State.llm.cfg.url, model: State.llm.cfg.model }
    })
  })
  .then(r => r.json())
  .then(data => {
    if (data.error) throw new Error(data.error);
    // 仅更新 chunks，不替换整个 currentData
    // 合并 word_defs / phrase_defs（保留旧数据，加入新数据）
    Object.assign(State.wordDefs, data.word_defs || {});
    Object.assign(State.phraseDefs, data.phrase_defs || {});
    // 更新当前卡片的 chunks 和 full_en
    if (State.currentData) {
      State.currentData.chunks = data.chunks || [];
      State.currentData.full_en = text;
      State.currentData.word_defs = State.wordDefs;
      State.currentData.phrase_defs = State.phraseDefs;
    } else {
      State.currentData = data;
    }
    // 保留已有 styles，仅更新 casual 为当前文本
    if (!State.styles || Object.keys(State.styles).length === 0) {
      State.styles = data.styles || {};
    }
    State.styles.casual = text;
    State.activeStyle = 'casual';
    // 不清除 TTS 缓存和 _styleChunkCache
    renderCard(State.currentData);
  })
  .catch(err => alert('拆分失败：' + err.message))
  .finally(() => {
    btn.disabled = false;
    btn.classList.remove('loading');
  });
});

// ────────────────────────────────────────
//  生词模式悬浮开关
// ────────────────────────────────────────
const vocabToggle = document.getElementById('vocabToggle');
let vocabTimer = null;
function showVocabTip() {
  hideVocabTip();
  const btn = document.getElementById('vocabToggle');
  if (!btn) return;
  const r = btn.getBoundingClientRect();
  const tip = document.createElement('div');
  tip.id = 'vocabTip';
  tip.textContent = '点击开启，红色表示可标注生词，生词会高亮显示';
  tip.style.cssText = 'position:fixed;right:' + (window.innerWidth - r.left + 12) + 'px;top:' + (r.top + r.height / 2) + 'px;transform:translateY(-50%);max-width:180px;background:rgba(80,80,85,0.82);color:rgba(255,255,255,0.88);padding:6px 10px;border-radius:8px;font-family:"PingFang SC","Microsoft YaHei",sans-serif;font-size:12px;line-height:1.5;z-index:200;pointer-events:none;opacity:0;transition:opacity .2s;box-shadow:0 2px 8px rgba(0,0,0,.08)';
  document.body.appendChild(tip);
  requestAnimationFrame(() => tip.style.opacity = '1');
  vocabTimer = setTimeout(hideVocabTip, 3000);
}
function hideVocabTip() {
  clearTimeout(vocabTimer);
  const el = document.getElementById('vocabTip');
  if (el) { el.style.opacity = '0'; setTimeout(() => el.remove(), 200); }
}
if (vocabToggle) {
  vocabToggle.addEventListener('mouseenter', showVocabTip);
  vocabToggle.addEventListener('mouseleave', hideVocabTip);
  vocabToggle.addEventListener('click', function () {
    State.vocabMode = !State.vocabMode;
    vocabToggle.classList.toggle('on', State.vocabMode);
    vocabToggle.textContent = State.vocabMode ? '生词标注 ●' : '生词标注';
    const legendSpan = document.querySelectorAll('.legend span')[2];
    if (legendSpan) {
      legendSpan.innerHTML = '<i class="swatch sw-marked"></i>点击单词 = ' + (State.vocabMode ? '生词标注' : '听该词发音');
    }
    // Refresh all words display
    refreshVocabDisplay();
  });
}

// 刷新生词标注显示
function refreshVocabDisplay() {
  document.querySelectorAll('.word.marked').forEach(w => {
    const cn = w.dataset.cn || State.wordDefs[w.dataset.w] || '';
    if (cn && !w.dataset.cn) w.dataset.cn = cn;
    // 在 .tok 上方插入中文
    const tok = w.closest('.tok');
    if (tok && !tok.querySelector('.word-cn')) {
      const cnSpan = document.createElement('span');
      cnSpan.className = 'word-cn';
      cnSpan.textContent = w.dataset.cn;
      tok.insertBefore(cnSpan, tok.firstChild);
    }
  });
}

// ── 浏览器音色（悬浮按钮 + 折叠面板） ──────────────
let _voiceList = [];           // 缓存语音列表
let _voiceFilterEn = false;    // "English Only" 筛选
let _voicePollTimer = null;    // 轮询定时器

// 已知男女声映射（macOS / Windows 常见音色）
const VOICE_GENDER = {
  // Female ♀
  female: ['Samantha','Victoria','Fiona','Karen','Moira','Tessa','Susan','Allison','Ava','Zoe','Serena','Kate','Ellen','Laila','Anna','Mei-Jia','Sin-ji','Ting-Ting','Zira','Hazel','Catherine','Veena','Ananya','Sandy','Elena','Paulina','Luciana','Amelie','Anne','Marie','Ellen','Kanya','Lekha','Yuna','Xander\'s Sister'],
  // Male ♂
  male: ['Alex','Daniel','Tom','Oliver','Aaron','Lee','Rishi','Fred','Thiago','Lucas','Diego','Yannick','Thomas','Xander','Guy','Markus','Mikko','Nicky','Rishi','Tarik','Antoine','Jorge','Kanya','Satu','Yelda']
};

function voiceGender(name) {
  if (!name) return '';
  const n = name.toLowerCase();
  for (const f of VOICE_GENDER.female) if (n === f.toLowerCase()) return '\u2640';
  for (const m of VOICE_GENDER.male) if (n === m.toLowerCase()) return '\u2642';
  // 模糊匹配：名字含常见女性/男性关键词
  if (/samantha|victoria|fiona|karen|moira|tessa|susan|allison|ava|zoe|serena|kate|ellen|laila|anna|hazel|catherine|veena|ananya|amelie|marie|paulina|luciana|elena|ting|mei|sin/i.test(name)) return '\u2640';
  if (/alex|daniel|oliver|aaron|fred|thiago|lucas|diego|yannick|thomas|xander|guy|markus|mikko|tarik|antoine|jorge/i.test(name)) return '\u2642';
  return '';
}

function voiceLabel(v) {
  const g = voiceGender(v.name);
  const tag = g ? ' ' + g : '';
  return v.name + tag + ' (' + v.lang + ')';
}

function populateVoicePanel() {
  const fab   = document.getElementById('voiceFab');
  const pop   = document.getElementById('voicePanel');
  const body  = document.getElementById('voicePanelBody');
  if (!fab || !pop || !body) return;

  // 仅浏览器档显示悬浮按钮
  const provider = ($('#ttsProvider') || {}).value || 'browser';
  if (provider !== 'browser') { fab.classList.remove('show'); pop.classList.remove('show'); return; }
  fab.classList.add('show');

  const allVoices = window.speechSynthesis ? speechSynthesis.getVoices() : [];

  // 空列表 → 显示 loading + 启动轮询
  if (allVoices.length === 0) {
    body.innerHTML = '<p class="voice-loading">正在加载音色…</p>';
    startVoicePoll();
    return;
  }
  stopVoicePoll();
  _voiceList = allVoices;

  // 默认选中 en-GB → en-* → 第一个
  const selURI = State.tts.cfg && State.tts.cfg.browserVoiceURI;
  if (!selURI) {
    const def = allVoices.find(v => /en-GB/i.test(v.lang)) || allVoices.find(v => /^en/i.test(v.lang)) || allVoices[0] || null;
    if (def) { State.tts.cfg = State.tts.cfg || {}; State.tts.cfg.browserVoiceURI = def.voiceURI; }
  }
  const finalSel = State.tts.cfg && State.tts.cfg.browserVoiceURI;

  // 英语排前面
  const ens    = allVoices.filter(v => /^en/i.test(v.lang));
  const others = allVoices.filter(v => !/^en/i.test(v.lang));
  const list   = _voiceFilterEn ? ens : ens.concat(others);

  // 渲染下拉（带性别标记）
  let html = '<select id="vpSelect">';
  list.forEach(v => {
    const attr = (v.voiceURI === finalSel) ? ' selected' : '';
    html += '<option value="' + v.voiceURI + '"' + attr + '>' + voiceLabel(v) + '</option>';
  });
  if (!_voiceFilterEn && ens.length > 0 && others.length > 0) {
    html += '<option disabled>──── 其他 ────</option>';
    others.forEach(v => {
      const attr = (v.voiceURI === finalSel) ? ' selected' : '';
      html += '<option value="' + v.voiceURI + '"' + attr + '>' + voiceLabel(v) + '</option>';
    });
  }
  html += '</select>';
  html += '<div class="voice-pop-foot"><input type="checkbox" id="vpOnlyEn"' + (_voiceFilterEn ? ' checked' : '') + '><label for="vpOnlyEn">English Only</label></div>';
  body.innerHTML = html;

  // 事件绑定
  body.querySelector('#vpSelect').addEventListener('change', function () {
    State.tts.cfg = State.tts.cfg || {};
    State.tts.cfg.browserVoiceURI = this.value;
    const v = _voiceList.find(x => x.voiceURI === this.value);
    updateVoicePanelBadge(v || null);
  });
  body.querySelector('#vpOnlyEn').addEventListener('change', function () {
    _voiceFilterEn = this.checked;
    populateVoicePanel();
  });

  // 同步 badge
  const voice = allVoices.find(v => v.voiceURI === finalSel);
  updateVoicePanelBadge(voice || null);
}

function updateVoicePanelBadge(voice) {
  // 同步连接面板里的 badge
  const connBadge = document.getElementById('voiceBadge');
  if (connBadge) {
    const base = '当前语音：浏览器';
    if (voice) {
      const g = voiceGender(voice.name);
      const tag = g ? ' ' + g : '';
      connBadge.textContent = base + ' — ' + voice.name + tag + ' (' + voice.lang + ')';
    } else {
      connBadge.textContent = base + '（自动选英式）';
    }
  }
}

// 悬浮按钮点击 → 展开/收起
if (document.getElementById('voiceFab')) {
  document.getElementById('voiceFab').addEventListener('click', function (e) {
    e.stopPropagation();
    const pop = document.getElementById('voicePanel');
    if (pop) pop.classList.toggle('show');
  });
}
// 关闭按钮
if (document.getElementById('voiceClose')) {
  document.getElementById('voiceClose').addEventListener('click', function () {
    const pop = document.getElementById('voicePanel');
    if (pop) pop.classList.remove('show');
  });
}
// 点击外部收起
document.addEventListener('click', function (e) {
  const pop = document.getElementById('voicePanel');
  const fab = document.getElementById('voiceFab');
  if (pop && fab && pop.classList.contains('show') && !pop.contains(e.target) && !fab.contains(e.target)) {
    pop.classList.remove('show');
  }
});

// 轮询：补偿 voiceschanged 可能已触发过的情况
function startVoicePoll() {
  if (_voicePollTimer) return;
  _voicePollTimer = setInterval(function () {
    const vs = window.speechSynthesis ? speechSynthesis.getVoices() : [];
    if (vs.length > 0) { populateVoicePanel(); }
  }, 500);
}
function stopVoicePoll() {
  if (_voicePollTimer) { clearInterval(_voicePollTimer); _voicePollTimer = null; }
}

// voiceschanged 也作为补偿
if (window.speechSynthesis) {
  speechSynthesis.onvoiceschanged = function () { populateVoicePanel(); };
}

// ────────────────────────────────────────
const TTS = {
  engine: 'backend',
  _audio: null,
  _currentBtn: null,
  _loadingBtn: null,
  cache: {},

  _cacheKey(text, voiceId) { return (voiceId || 'default') + '::' + text; },
  _cacheGet(t, v) { return this.cache[this._cacheKey(t, v)] || null; },
  _cacheSet(t, v, data) {
    const k = this._cacheKey(t, v);
    if (Object.keys(this.cache).length >= 80) delete this.cache[Object.keys(this.cache)[0]];
    this.cache[k] = data; // { b64, mime }
  },
  clearCache() { this.cache = {}; },

  _setBtn(btn, state) {
    if (!btn) return;
    btn.classList.remove('playing', 'loading');
    btn.disabled = false;
    if (state) btn.classList.add(state);
    if (state === 'loading') btn.disabled = true;
  },

  _playCached(btn, cached, onend) {
    try {
      const mime = (cached && cached.mime) || 'audio/mpeg';
      const src = 'data:' + mime + ';base64,' + cached.b64;
      this._audio = new Audio(src);
      this._currentBtn = btn;
      this._setBtn(btn, 'playing');
      this._audio.onplay  = null;
      this._audio.onended = () => {
        if (this._currentBtn === btn) { this._setBtn(btn, null); this._currentBtn = null; }
        if (onend) onend();
      };
      this._audio.onerror = () => {
        if (this._currentBtn === btn) { this._setBtn(btn, null); this._currentBtn = null; }
        if (onend) onend();
      };
      this._audio.play();
    } catch (e) {
      console.error('[TTS cache play]', e);
      if (btn) { this._setBtn(btn, null); this._currentBtn = null; }
    }
  },

  _playBackend(text, onstart, onend, onload) {
    const provider = ($('#ttsProvider') || {}).value || 'browser';
    const key = ($('#ttsKey') || {}).value || '';
    const baseUrl = ($('#ttsBaseUrl') || {}).value || '';
    const kokoroSpeedEl = document.getElementById('kokoroSpeed');
    const voiceId = (provider === 'kokoro')
      ? resolveKokoroVoice(text)   // 自动检测文本语言并匹配音色
      : (($('#ttsVoice') || {}).value || 'Xb7hH8MSUJpSbSDYk0k2');
    const speed = (provider === 'kokoro' && kokoroSpeedEl) ? parseFloat(kokoroSpeedEl.value) : 1.0;

    if (PLANNED_TTS.includes(provider)) {
      this._toast((PLANNED_NAMES[provider] || provider) + ' 即将支持');
      if (this._loadingBtn) { this._setBtn(this._loadingBtn, null); this._loadingBtn = null; }
      return;
    }

    // ── 浏览器：直接用 speechSynthesis ──
    if (provider === 'browser') {
      this._browserSpeak(text, onstart, onend);
      return;
    }

    // ── Kokoro / ElevenLabs / OpenAI 等：统一走后端 /api/tts ──
    // Kokoro 已内置为后端原生引擎，后端进程内直接调用 ONNX 模型，无跨进程 HTTP
    const model = ($('#ttsModel') || {}).value || '';
    const body = { text, provider, tts: { apiKey: key, voiceId, baseUrl, model, speed } };
    if (onload) onload();
    fetch('/api/tts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(r => r.json())
      .then(data => {
        if (!data.audioBase64) throw new Error(data.error || '没有返回音频');
        this._cacheSet(text, voiceId + '@' + provider, { b64: data.audioBase64, mime: data.mime || 'audio/wav' });
        const src = 'data:' + (data.mime || 'audio/wav') + ';base64,' + data.audioBase64;
        this._audio = new Audio(src);
        this._audio.onplay  = onstart  || null;
        this._audio.onended = () => {
          if (this._currentBtn === btn) { this._setBtn(btn, null); this._currentBtn = null; }
          if (onend) onend();
        };
        this._audio.onerror = () => {
          if (this._currentBtn === btn) { this._setBtn(btn, null); this._currentBtn = null; }
          if (onend) onend();
        };
        this._audio.play().catch(() => {
          this._toast('播放失败');
          if (this._loadingBtn) { this._setBtn(this._loadingBtn, null); this._loadingBtn = null; }
          if (onend) onend();
        });
      })
      .catch(err => {
        this._toast('朗读失败: ' + err.message);
        if (this._loadingBtn) { this._setBtn(this._loadingBtn, null); this._loadingBtn = null; }
        if (onend) onend();
      });
  },

  _fallback(text, onstart, onend, onload, reason) {
    console.warn('[TTS]', reason); this._toast(reason);
    this.engine = 'browser';
    if (onload) onload();
    this._browserSpeak(text, onstart, onend);
    this.engine = 'backend';
  },

  _pickVoice(text) {
    const textLang = detectLang(text || '');
    // 用户显式选了音色：仅在语言匹配时使用，否则自动选
    const uri = State.tts.cfg && State.tts.cfg.browserVoiceURI;
    if (uri) {
      const v = (window.speechSynthesis ? speechSynthesis.getVoices() : []).find(x => x.voiceURI === uri);
      if (v) {
        if (textLang === 'en') return v;
        const vLang = (v.lang || '').toLowerCase();
        if (vLang.startsWith(textLang === 'zh' ? 'zh' : 'ja')) return v;
      }
    }
    const vs = window.speechSynthesis ? speechSynthesis.getVoices() : [];
    if (textLang === 'zh') {
      return vs.find(v => /^zh/i.test(v.lang)) || vs.find(v => /^cmn/i.test(v.lang)) || vs[0] || null;
    }
    if (textLang === 'ja') {
      return vs.find(v => /^ja/i.test(v.lang)) || vs[0] || null;
    }
    return vs.find(v => /en-GB/i.test(v.lang)) || vs.find(v => /^en/i.test(v.lang)) || vs[0] || null;
  },

  _browserSpeak(text, onstart, onend) {
    if (!('speechSynthesis' in window)) { alert('浏览器不支持朗读'); if (onend) onend(); return; }
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    const v = this._pickVoice(text);
    if (v) u.voice = v;
    const lang = detectLang(text);
    u.lang = (v && v.lang) || (lang === 'zh' ? 'zh-CN' : lang === 'ja' ? 'ja-JP' : 'en-GB');
    u.rate = 0.95;
    u.onstart = onstart || null;
    u.onend   = onend   || null;
    u.onerror = onend   || null;
    speechSynthesis.speak(u);
  },

  stop() {
    if (this._audio) { this._audio.pause(); this._audio.currentTime = 0; this._audio = null; }
    if (window.speechSynthesis) speechSynthesis.cancel();
    if (this._currentBtn) { this._setBtn(this._currentBtn, null); this._currentBtn = null; }
    if (this._loadingBtn) { this._setBtn(this._loadingBtn, null); this._loadingBtn = null; }
  },

  _toast(msg) {
    let el = document.getElementById('ttsToast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'ttsToast';
      el.style.cssText = 'position:fixed;bottom:70px;left:50%;transform:translateX(-50%);background:#1d1d1f;color:#fff;padding:8px 14px;border-radius:8px;font-family:sans-serif;font-size:12px;z-index:200;opacity:0;transition:opacity .25s ease;pointer-events:none;';
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.style.opacity = '1';
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => { el.style.opacity = '0'; }, 2500);
  },

  // speak(btn, text): btn = 按钮 DOM 元素（单词级可为 null）
  speak(btn, text) {
    if (this._currentBtn === btn && btn) { this.stop(); return; }
    this.stop();

    const provider = ($('#ttsProvider') || {}).value || 'browser';

    // Kokoro 模型不支持中文/日文 G2P，遇到 CJK 文本自动降级到浏览器语音
    if (provider === 'kokoro' && detectLang(text) !== 'en') {
      const langName = detectLang(text) === 'zh' ? '中文' : '日文';
      this._toast(langName + ' 自动使用浏览器语音（Kokoro 不支持该语言）');
      if (btn) { this._loadingBtn = btn; this._setBtn(btn, 'loading'); }
      this._browserSpeak(
        text,
        () => { this._loadingBtn = null; this._currentBtn = btn; this._setBtn(btn, 'playing'); },
        () => { if (this._currentBtn === btn) { this._setBtn(btn, null); this._currentBtn = null; } }
      );
      return;
    }

    // 动态读取当前音色（与 _playBackend 逻辑一致）
    let voiceId;
    if (provider === 'kokoro') {
      voiceId = resolveKokoroVoice(text);   // 自动检测文本语言并匹配音色
    } else if (provider === 'browser') {
      voiceId = (State.tts.cfg && State.tts.cfg.browserVoiceURI) || 'browser';
    } else {
      voiceId = (State.tts.cfg && State.tts.cfg.voiceId) || 'default';
    }
    const cacheKey = voiceId + '@' + provider;
    const cached = this._cacheGet(text, cacheKey);
    if (cached) { this._playCached(btn, cached, null); return; }

    if (btn) {
      this._loadingBtn = btn;
      this._setBtn(btn, 'loading');
    }
    this._playBackend(
      text,
      () => { this._loadingBtn = null; this._currentBtn = btn; this._setBtn(btn, 'playing'); },
      () => { if (this._currentBtn === btn) { this._setBtn(btn, null); this._currentBtn = null; } },
      () => {}
    );
  }
};
if (window.speechSynthesis) { speechSynthesis.onvoiceschanged = function(){}; }

function bindPlayButtons() {
  document.querySelectorAll('.play-btn').forEach(btn => {
    btn.addEventListener('click', function () {
      const text = btn.getAttribute('data-say') || '';
      if (!text) return;
      TTS.speak(btn, text);
    });
  });
}


// ── 导出离线 HTML ────────────────────────
function showExportModal() {
  if (!State.currentData) { alert('请先生成一张卡片再导出。'); return; }
  const allStyles = State.styles && Object.keys(State.styles).length ? Object.keys(State.styles) : ['casual','formal','vlog','swagger','chill'];
  const labels = { casual: '日常', formal: '正式', vlog: 'Vlog', swagger: '嚣张', chill: '松弛' };
  let styleChecks = '';
  allStyles.forEach((k, i) => {
    const isReady = k === 'casual' || (State._styleChunkCache && State._styleChunkCache[k] && validateChunks(State._styleChunkCache[k]))
      || (State.currentData.style_chunks && State.currentData.style_chunks[k] && validateChunks(State.currentData.style_chunks[k]));
    const status = isReady ? '' : (State._loadingStyles && State._loadingStyles.has(k) ? ' ⏳' : ' ⚠');
    styleChecks += '<label class="style-check"><input type="checkbox" value="' + k + '" checked><span>' + (labels[k] || k) + status + '</span></label>';
  });
  const mask = document.createElement('div');
  mask.className = 'modal-mask';
  mask.innerHTML =
    '<div class="modal">' +
    '<h2>导出离线卡片</h2>' +
    '<div class="modal-section"><div class="modal-section-title">选择风格</div>' +
    '<div class="style-checks">' + styleChecks + '</div>' +
    '</div>' +
    '<div class="modal-options">' +
    '<label class="modal-opt"><input type="radio" name="exportOpt" value="cached" style="margin-right:8px"><span class="opt-title">只打包已朗读的句子</span><span class="opt-desc">仅内嵌已缓存音频，未朗读句子无音频</span></label>' +
    '<label class="modal-opt"><input type="radio" name="exportOpt" value="all" checked style="margin-right:8px"><span class="opt-title">自动补全所有句子</span><span class="opt-desc">将所有句子用 TTS 合成后打包（推荐）</span></label>' +
    '</div>' +
    '<div class="modal-note">导出的离线卡片中，句子播放使用内嵌 TTS 真人音频；单词点击朗读使用浏览器语音。</div>' +
    '<div class="modal-actions"><button class="btn secondary" id="modalCancel">取消</button><button class="btn btn-green" id="modalOk">导出</button></div>' +
    '</div>';
  document.body.appendChild(mask);
  mask.querySelector('#modalCancel').onclick = () => mask.remove();
  mask.onclick = (e) => { if (e.target === mask) mask.remove(); };
  mask.querySelector('#modalOk').onclick = async () => {
    const mode = mask.querySelector('input[name="exportOpt"]:checked').value;
    const selected = Array.from(mask.querySelectorAll('.style-checks input:checked')).map(cb => cb.value);
    mask.remove();
    await exportOfflineHtml(mode, selected.length > 0 ? selected : allStyles);
  };
}

async function exportOfflineHtml(mode, selectedStyles) {
  const btn = document.getElementById('btnExport');
  const orig = btn.textContent;
  btn.textContent = '导出中…'; btn.disabled = true;
  try {
    const data = JSON.parse(JSON.stringify(State.currentData));
    const fullText = (document.getElementById('fullEnText') || {}).innerText || data.full_en;
    data.full_en = fullText;

    const allStyles = State.styles && Object.keys(State.styles).length ? Object.keys(State.styles) : ['casual','formal','vlog','swagger','chill'];
    const styleKeys = (selectedStyles && selectedStyles.length > 0) ? allStyles.filter(s => selectedStyles.includes(s)) : allStyles;

    // Helper: get TTS audio for a text (cache first, then generate if mode==='all')
    async function genAudio(text) {
      if (!text) return null;
      for (const k of Object.keys(TTS.cache)) {
        if (k.endsWith('::' + text)) {
          const entry = TTS.cache[k];
          if (entry && entry.b64) return entry.b64;
          if (typeof entry === 'string') return entry;
        }
      }
      if (mode !== 'all') return null;
      const ttsProvider = ($('#ttsProvider') || {}).value || 'browser';
      const canGen = ttsProvider === 'kokoro' || (State.tts.cfg && State.tts.cfg.key);
      if (!canGen || ttsProvider === 'browser') return null;
      try {
        const kokoroVoiceEl = document.getElementById('kokoroVoice');
        const kokoroSpeedEl = document.getElementById('kokoroSpeed');
        const voice = (ttsProvider === 'kokoro' && kokoroVoiceEl) ? kokoroVoiceEl.value : ((State.tts.cfg && State.tts.cfg.voiceId) || 'default');
        const speed = (ttsProvider === 'kokoro' && kokoroSpeedEl) ? parseFloat(kokoroSpeedEl.value) : ((State.tts.cfg && State.tts.cfg.speed) || 1.0);
        const apiKey = (ttsProvider === 'kokoro') ? 'local' : ((State.tts.cfg && State.tts.cfg.key) || '');
        const baseUrl = (State.tts.cfg && State.tts.cfg.baseUrl) || '';
        const model = (($('#ttsModel') || {}).value) || '';
        const res = await fetch('/api/tts', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text, provider: ttsProvider,
            tts: { apiKey, voiceId: voice, baseUrl, model, speed } })
        });
        const j = await res.json();
        if (j.audioBase64) {
          TTS._cacheSet(text, voice + '@' + ttsProvider, { b64: j.audioBase64, mime: j.mime || 'audio/mpeg' });
          return j.audioBase64;
        }
      } catch (_) {}
      return null;
    }

    // 导出前同步预加载：分两批加载风格拆分
    // 第一批完成后至少 2-3 个风格完整可用
    btn.textContent = '预加载中…';
    const needLoad = styleKeys.filter(s => {
      const st = State.styles[s] || data.full_en;
      if (!st || st === data.full_en) return false;
      if (data.style_chunks && data.style_chunks[s] && validateChunks(data.style_chunks[s])) return false;
      if (State._styleChunkCache && State._styleChunkCache[s] && validateChunks(State._styleChunkCache[s])) return false;
      return true;
    });
    const splitAt = Math.min(3, needLoad.length);
    const expBatch1 = needLoad.slice(0, splitAt);
    const expBatch2 = needLoad.slice(splitAt);

    async function preloadStyle(style) {
      const styleText = State.styles[style] || data.full_en;
      const aData = await fetchAnalyzeChunks(styleText, State.llm.cfg);
      if (!aData || !aData.chunks || !validateChunks(aData.chunks)) return;
      if (!State._styleChunkCache) State._styleChunkCache = {};
      State._styleChunkCache[style] = aData.chunks;
      Object.assign(State.wordDefs, aData.word_defs || {});
      Object.assign(State.phraseDefs, aData.phrase_defs || {});
    }

    // 第一批 → 完成后第二批
    await Promise.all(expBatch1.map(preloadStyle));
    btn.textContent = '预加载中… (第二批)';
    await Promise.all(expBatch2.map(preloadStyle));
    btn.textContent = '合成音频中…';

    // Gather chunks and audio for each style
    const styleChunks = {};
    const styleData = {};
    for (const style of styleKeys) {
      const styleText = State.styles[style] || data.full_en;
      let chunks;
      if (styleText === data.full_en) {
        chunks = data.chunks || [];
      } else if (data.style_chunks && data.style_chunks[style] && validateChunks(data.style_chunks[style])) {
        chunks = data.style_chunks[style];
      } else if (State._styleChunkCache && State._styleChunkCache[style] && validateChunks(State._styleChunkCache[style])) {
        chunks = State._styleChunkCache[style];
      } else {
        // 数据不完整 → 跳过此风格，不导出残缺数据
        continue;
      }
      styleChunks[style] = chunks;

      const fullAudio = await genAudio(styleText);
      const chunkAudio = [];
      for (const chunk of chunks) {
        const b64 = await genAudio(chunk.en);
        chunkAudio.push({ text: chunk.en, audio: b64 });
      }
      styleData[style] = { fullAudio, chunkAudio };
    }

    downloadStandalone(data, styleChunks, styleData);
  } catch (e) {
    alert('导出失败：' + e.message);
  } finally {
    btn.textContent = orig; btn.disabled = false;
  }
}

function downloadStandalone(data, styleChunks, styleData) {
  const allKeys = State.styles && Object.keys(State.styles).length ? Object.keys(State.styles) : ['casual','formal','vlog','swagger','chill'];
  // 只保留有完整数据的风格
  const styleKeys = allKeys.filter(k => styleChunks[k] && styleChunks[k].length > 0);
  let activeStyle = State.activeStyle || 'casual';
  // 如果当前风格被跳过，回退到日常或第一个可用风格
  if (!styleKeys.includes(activeStyle)) {
    activeStyle = styleKeys.includes('casual') ? 'casual' : (styleKeys[0] || 'casual');
  }
  const currentText = (activeStyle && State.styles && State.styles[activeStyle]) ? State.styles[activeStyle] : data.full_en;
  const labels = { casual: '日常', formal: '正式', vlog: 'Vlog', swagger: '嚣张', chill: '松弛' };

  let styleBar = '<div class="style-bar">';
  styleKeys.forEach(k => {
    const act = k === activeStyle ? ' active' : '';
    styleBar += '<button class="style-btn' + act + '" data-style="' + k + '">' + (labels[k] || k) + '</button>';
  });
  styleBar += '</div>';

  const safeHtml = (s) => (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const safeAttr = (s) => (s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const safeJson = (obj) => JSON.stringify(obj)
    .replace(/</g, '\\u003c')
    .replace(/`/g, '\\`')
    .replace(/\$\{/g, '\\${');
  const jsonData = safeJson(State.currentData || data);
  const jsonStyles = safeJson(State.styles || {});
  const jsonStyleChunks = safeJson(styleChunks);
  const jsonStyleData = safeJson(styleData);
  const initFullAudio = (styleData[activeStyle] && styleData[activeStyle].fullAudio) ? ' data-audio="' + styleData[activeStyle].fullAudio + '"' : '';

  const html = `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>情景英语学习 · 离线卡片</title>
<style>
:root{--ink:#1d1d1f;--muted:#6a6a70;--ipa:#b5794a;--marked:#b23a47;--paper:#eef1f6;--card:#fff;--card-border:rgba(0,0,0,.07);--line:rgba(0,0,0,.1);--accent:#4d4d55}
*{box-sizing:border-box;margin:0;padding:0}
body{background:var(--paper);color:var(--ink);font-family:"Iowan Old Style","Palatino Linotype",Palatino,Georgia,serif;line-height:1.5}
.wrap{max-width:820px;margin:0 auto;padding:40px 28px 96px}
.style-bar{display:flex;gap:6px;margin:12px 0 14px;flex-wrap:wrap}
.style-btn{font-family:"Gill Sans","Avenir Next",sans-serif;font-size:12px;letter-spacing:.04em;padding:6px 12px;border-radius:7px;border:1px solid var(--line);background:#fff;color:var(--accent);cursor:pointer;transition:background .15s,color .15s}
.style-btn:hover{background:#f4f4f5}.style-btn.active{background:#8e8e93;color:#fff;border-color:#8e8e93}
.overview{position:relative;background:transparent;border:none;border-radius:0;padding:0;margin-bottom:30px;box-shadow:none}
.play-full{position:absolute;top:7px;right:10px;z-index:2}
.full-en{display:block;width:100%;min-height:48px;padding:12px 16px;padding-right:42px;border:1px solid var(--card-border);border-radius:14px;font-family:"PingFang SC","Hiragino Sans GB","Microsoft YaHei","Iowan Old Style",serif;font-size:15px;line-height:1.6;color:var(--ink);background:#fff;outline:none;box-shadow:0 2px 10px rgba(30,40,80,.05),0 0 8px rgba(255,165,80,.25);animation:full-en-breathe 4s ease-in-out infinite}
@keyframes full-en-breathe{0%,100%{box-shadow:0 2px 10px rgba(30,40,80,.05),0 0 6px rgba(255,165,80,.2)}50%{box-shadow:0 2px 10px rgba(30,40,80,.05),0 0 14px rgba(255,165,80,.4)}}
.play-btn{display:inline-flex;align-items:center;justify-content:center;width:34px;height:34px;border-radius:50%;border:1px solid var(--card-border);background:#fff;color:var(--accent);cursor:pointer;box-shadow:0 2px 8px rgba(30,40,80,.08);transition:transform .1s,background .15s,color .15s}.play-btn:hover{background:#1d1d1f;color:#fff;transform:scale(1.06)}.play-btn:active{transform:scale(0.96)}.play-btn svg{width:15px;height:15px;display:block;fill:currentColor}.play-btn.playing{background:var(--marked);color:#fff;border-color:var(--marked)}
.chunk{position:relative;background:var(--card);border:1px solid var(--card-border);border-radius:18px;padding:14px 22px 14px;margin-bottom:14px;box-shadow:0 4px 18px rgba(255,165,80,0.08)}
.chunk-num-dot{position:absolute;left:-26px;top:14px;width:20px;height:20px;border-radius:50%;background:#d1d1d6;color:#fff;font-size:11px;font-weight:600;font-family:"Gill Sans","Avenir Next",sans-serif;display:flex;align-items:center;justify-content:center;z-index:1;flex-shrink:0}
.chunk .play-btn{position:absolute;top:14px;right:14px;z-index:2}
.chunk .line{padding-right:42px}
.line{display:flex;flex-wrap:wrap;align-items:flex-end;gap:4px 14px}
.tok{display:flex;flex-direction:column;align-items:center;text-align:center;position:relative;padding-top:0}
.tok:has(.word-cn){padding-top:16px}
.word{font-size:21px;font-weight:500;letter-spacing:.01em;white-space:nowrap;color:var(--ink);cursor:pointer;border-radius:4px;padding:0 2px;transition:color .12s,background .12s}.word:hover{background:rgba(255,55,95,0.08)}.word.collo{font-weight:800}.word.marked{color:var(--marked)}
.ipa{font-size:14px;color:var(--ipa);margin-top:5px;white-space:nowrap;font-family:"Gill Sans","Avenir Next",sans-serif}
.zh{margin-top:10px;padding-top:10px;border-top:1px dashed var(--line);font-size:16px;color:var(--accent);font-family:"PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif}
.word-cn{font-size:12px;color:var(--marked);font-weight:500;font-family:"PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;white-space:nowrap;display:block;line-height:1.4}
#tip{position:fixed;z-index:50;max-width:260px;background:#fff;color:var(--ink);border:1px solid rgba(0,0,0,.08);border-radius:16px;padding:11px 13px;font-family:"PingFang SC","Microsoft YaHei",sans-serif;font-size:13.5px;line-height:1.5;box-shadow:0 14px 40px rgba(30,40,80,.22);pointer-events:none;opacity:0;transform:translateY(4px);transition:opacity .12s,transform .12s}#tip.show{opacity:1;transform:translateY(0)}
.t-word{font-family:"Gill Sans","Avenir Next",sans-serif;font-weight:700;font-size:14px;margin-right:6px}
.t-phrase{margin-top:8px;padding-top:8px;border-top:1px solid rgba(0,0,0,.1);color:#a12f74;font-family:"PingFang SC","Microsoft YaHei",sans-serif}
.vocab-toggle{position:fixed;bottom:24px;right:24px;z-index:100;padding:10px 14px;border-radius:22px;background:var(--ink);color:#fff;border:none;cursor:pointer;font-family:"Gill Sans","Avenir Next",sans-serif;font-size:12px;letter-spacing:.04em;box-shadow:0 4px 14px rgba(0,0,0,.18);transition:background .2s,transform .1s;white-space:nowrap}.vocab-toggle:hover{background:#2a2a2e;transform:scale(1.03)}.vocab-toggle.on{background:var(--marked)}
@media print{.wrap{padding:24px;max-width:100%}.chunk{break-inside:avoid;box-shadow:none}.vocab-toggle{display:none}}
</style>
</head>
<body>
<div id="tip"></div>
<div class="wrap">
${styleBar}
<div class="overview">
<button class="play-btn play-full" data-say="${safeAttr(currentText)}"${initFullAudio}><svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg></button>
<div class="full-en" id="fullEnText" contenteditable="true" spellcheck="false">${safeHtml(currentText)}</div>
</div>
<div id="chunksContainer"></div>
</div>
<button class="vocab-toggle" id="vocabToggle">生词模式</button>
<script>
var DATA=${jsonData};var STYLES=${jsonStyles};var STYLE_CHUNKS=${jsonStyleChunks};var STYLE_DATA=${jsonStyleData};var vocabMode=false;var curStyle='${activeStyle}';var curAudio=null;
function clean(s){return s.toLowerCase().replace(/[^a-z]/g,'').replace(/'/g,'')}
function norm(s){return s.toLowerCase().replace(/[^a-z]/g,'')}
function look(w){var d=clean(w);if(!d)return null;var defs=DATA.word_defs||{};if(defs[d])return defs[d];var c=new Set([d]);if(d.endsWith('s')&&d.length>3)c.add(d.slice(0,-1));if(d.endsWith('es')&&d.length>3)c.add(d.slice(0,-2));if(d.endsWith('ed')&&d.length>3){c.add(d.slice(0,-2));c.add(d.slice(0,-1))}if(d.endsWith('ing')&&d.length>4){c.add(d.slice(0,-3));c.add(d.slice(0,-3)+'e')}if(d.endsWith('ies')&&d.length>4)c.add(d.slice(0,-3)+'y');if(d.endsWith('ves')&&d.length>4)c.add(d.slice(0,-3)+'f');for(var cc of c)if(defs[cc])return defs[cc];return null}
function buildChunksHtml(chunks,chunkAudio){var html='';chunks.forEach(function(chunk,i){var en=chunk.en||'';var cn=chunk.cn||'';var toks=chunk.tokens||[];var collocations=chunk.collocations||[];var idxToPhrase={};collocations.forEach(function(col){var parts=col.split(' ').map(norm);for(var s=0;s+parts.length<=toks.length;s++){var hit=true;for(var j=0;j<parts.length;j++){if(norm(toks[s+j].w)!==parts[j]){hit=false;break}}if(hit)for(var j=0;j<parts.length;j++)idxToPhrase[s+j]=col}});var toksHtml=toks.map(function(tok,ti){var w=tok.w||'';var isCollo=idxToPhrase[ti]?' collo':'';var ph=idxToPhrase[ti]?' data-phrase="'+idxToPhrase[ti]+'" data-phrasedef="'+((DATA.phrase_defs||{})[idxToPhrase[ti]]||'')+'"':'';return '<span class="tok"><span class="word'+isCollo+'" data-w="'+norm(w)+'"'+ph+'>'+w+'</span><span class="ipa">'+(tok.ipa||'')+'</span></span>'}).join('');var sa=chunkAudio.find(function(s){return s.text===en});var audioAttr=sa&&sa.audio?' data-audio="'+sa.audio+'"':'';html+='<div class="chunk"><span class="chunk-num-dot">'+(i+1)+'</span><button class="play-btn" data-say="'+en.replace(/"/g,'&quot;')+'"'+audioAttr+' aria-label="朗读这句"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg></button><div class="line">'+toksHtml+'</div>'+(cn?'<div class="zh">'+cn+'</div>':'')+'</div>'});return html}
var tip=document.getElementById('tip');
function showTip(w,x,y){var wc=w.dataset.w||clean(w.textContent);var def=look(wc)||'（暂无释义）';var html='<span class="t-word">'+w.textContent.replace(/[.,—]/g,'')+'</span>'+def;if(w.dataset.phrase&&w.dataset.phrasedef)html+='<div class="t-phrase">词组 <b>'+w.dataset.phrase+'</b>：'+w.dataset.phrasedef+'</div>';tip.innerHTML=html;tip.classList.add('show');var r=tip.getBoundingClientRect();var left=Math.min(Math.max(8,x-r.width/2),window.innerWidth-r.width-8);var top=y-r.height-12;if(top<8)top=y+20;tip.style.left=left+'px';tip.style.top=top+'px'}
function hideTip(){tip.classList.remove('show')}
function bindWords(){document.querySelectorAll('.word').forEach(function(w){w.addEventListener('click',function(){if(vocabMode){w.classList.toggle('marked');var tok=w.closest('.tok');if(w.classList.contains('marked')){var cn=look(w.dataset.w)||'';w.dataset.cn=cn;var cnSpan=tok.querySelector('.word-cn');if(!cnSpan){cnSpan=document.createElement('span');cnSpan.className='word-cn';tok.insertBefore(cnSpan,tok.firstChild)}cnSpan.textContent=cn}else{var cnSpan=tok.querySelector('.word-cn');if(cnSpan)cnSpan.remove()}}else{var t=w.textContent.trim();if(t){speechSynthesis.cancel();var u=new SpeechSynthesisUtterance(t);var vs=speechSynthesis.getVoices().find(function(v){return /en-GB/i.test(v.lang)})||speechSynthesis.getVoices().find(function(v){return /^en/i.test(v.lang)});if(vs)u.voice=vs;u.lang='en-GB';u.rate=0.95;speechSynthesis.speak(u)}}});w.addEventListener('mouseenter',function(e){var r=w.getBoundingClientRect();showTip(w,r.left+r.width/2,r.top)});w.addEventListener('mouseleave',hideTip)})}
function bindChunkPlay(){document.querySelectorAll('.chunk .play-btn').forEach(function(btn){btn.addEventListener('click',function(){var text=btn.getAttribute('data-say')||'';if(btn.classList.contains('playing')){if(curAudio){curAudio.pause();curAudio=null}btn.classList.remove('playing');return}document.querySelectorAll('.play-btn').forEach(function(b){b.classList.remove('playing')});if(curAudio){curAudio.pause();curAudio=null}var b64=btn.getAttribute('data-audio');if(b64){curAudio=new Audio('data:audio/mpeg;base64,'+b64);btn.classList.add('playing');curAudio.onended=function(){btn.classList.remove('playing');curAudio=null};curAudio.onerror=function(){btn.classList.remove('playing');curAudio=null};curAudio.play()}else{speechSynthesis.cancel();var u=new SpeechSynthesisUtterance(text);var vs=speechSynthesis.getVoices().find(function(v){return /en-GB/i.test(v.lang)})||speechSynthesis.getVoices().find(function(v){return /^en/i.test(v.lang)});if(vs)u.voice=vs;u.lang='en-GB';u.onend=function(){btn.classList.remove('playing')};u.onerror=function(){btn.classList.remove('playing')};btn.classList.add('playing');speechSynthesis.speak(u)}})})}
function renderChunks(style){curStyle=style;var chunks=STYLE_CHUNKS[style]||[];var sd=STYLE_DATA[style]||{fullAudio:null,chunkAudio:[]};var container=document.getElementById('chunksContainer');container.innerHTML=buildChunksHtml(chunks,sd.chunkAudio||[]);bindWords();bindChunkPlay();var ft=STYLES[style]||DATA.full_en;var fullEn=document.getElementById('fullEnText');if(fullEn)fullEn.innerText=ft;var pf=document.querySelector('.play-full');if(pf){pf.setAttribute('data-say',ft);if(sd.fullAudio){pf.setAttribute('data-audio',sd.fullAudio)}else{pf.removeAttribute('data-audio')}}}
var pfBtn=document.querySelector('.play-full');pfBtn.addEventListener('click',function(){var text=this.getAttribute('data-say')||'';if(this.classList.contains('playing')){if(curAudio){curAudio.pause();curAudio=null}this.classList.remove('playing');return}document.querySelectorAll('.play-btn').forEach(function(b){b.classList.remove('playing')});if(curAudio){curAudio.pause();curAudio=null}var b64=this.getAttribute('data-audio');var self=this;if(b64){curAudio=new Audio('data:audio/mpeg;base64,'+b64);self.classList.add('playing');curAudio.onended=function(){self.classList.remove('playing');curAudio=null};curAudio.onerror=function(){self.classList.remove('playing');curAudio=null};curAudio.play()}else{speechSynthesis.cancel();var u=new SpeechSynthesisUtterance(text);var vs=speechSynthesis.getVoices().find(function(v){return /en-GB/i.test(v.lang)})||speechSynthesis.getVoices().find(function(v){return /^en/i.test(v.lang)});if(vs)u.voice=vs;u.lang='en-GB';u.onend=function(){self.classList.remove('playing')};u.onerror=function(){self.classList.remove('playing')};self.classList.add('playing');speechSynthesis.speak(u)}});

document.querySelectorAll('.style-btn').forEach(function(b){b.addEventListener('click',function(){var s=b.dataset.style;if(!STYLES[s])return;document.querySelectorAll('.style-btn').forEach(function(x){x.classList.remove('active')});b.classList.add('active');renderChunks(s)})});
document.getElementById('vocabToggle').addEventListener('click',function(){vocabMode=!vocabMode;this.classList.toggle('on',vocabMode);this.textContent=vocabMode?'生词标注 ●':'生词模式'});
renderChunks(curStyle);
if(speechSynthesis)speechSynthesis.onvoiceschanged=function(){};
</script>
</body></html>`;

  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'situation-english-card.html';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 2000);

}

document.getElementById('btnExport').addEventListener('click', showExportModal);

// ── 播放输入框文字 ──────────────────────
document.getElementById('btnPlayInput').addEventListener('click', function () {
  const text = $('#inputText').value.trim();
  if (!text) return;
  TTS.speak(this, text);
});

// ── 输入框自适应高度 ──────────────────────
function autoResizeTextarea(el) {
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = el.scrollHeight + 'px';
}
(function () {
  const ta = document.getElementById('inputText');
  if (!ta) return;
  autoResizeTextarea(ta);
  ta.addEventListener('input', function () { autoResizeTextarea(ta); });
})();

// ── 首页加载内置示例卡片 ──────────────────────
(function () {
  State.currentData = DEMO_CARD;
  State.wordDefs = DEMO_CARD.word_defs || {};
  State.phraseDefs = DEMO_CARD.phrase_defs || {};
  State.styles = DEMO_CARD.styles || {};
  State.activeStyle = 'casual';
  renderCard(DEMO_CARD);
})();

// ── 每次刷新页面引导 — 聚光灯三步（播放→翻译→帮助） ──────────
// 规则：点当前高亮的按钮 = 进入下一步；点遮罩（高亮按钮以外的任意位置）= 跳过引导、直接进入页面
(function () {

  function startOnboarding() {
    var playBtn = document.querySelector('.play-full');
    var translateBtn = document.getElementById('btnGenerate');
    var helpBtn = document.getElementById('btnHelp');
    if (!playBtn || !translateBtn || !helpBtn) return;

    var mask = document.createElement('div');
    mask.className = 'onboard-mask';
    mask.id = 'onboardMask';
    document.body.appendChild(mask);

    var done = false;          // 引导已结束或已跳过
    var autoTimer2 = null;     // 第二步自动进入第三步的计时器
    var onPlay = null;
    var onTranslate = null;

    // 点遮罩（高亮按钮以外的任意位置）→ 跳过整个引导，直接进入页面
    function onMask(e) { if (e.target === mask) dismissAll(); }
    mask.addEventListener('click', onMask);

    function dismissAll() {
      if (done) return;
      done = true;
      clearTimeout(autoTimer2);
      mask.style.opacity = '0';
      mask.removeEventListener('click', onMask);
      document.querySelectorAll('.onboard-target').forEach(function (el) {
        el.classList.remove('onboard-target');
      });
      document.querySelectorAll('.onboard-hint').forEach(function (el) {
        el.remove();
      });
      setTimeout(function () { mask.remove(); }, 500);
    }

    function setSpotCircle(btn) {
      mask.classList.remove('spot-rect');
      mask.classList.add('spot-circle');
      var r = btn.getBoundingClientRect();
      var cx = r.left + r.width / 2;
      var cy = r.top + r.height / 2;
      var rad = Math.max(r.width, r.height) / 2 + 2;
      mask.style.setProperty('--spot-x', cx + 'px');
      mask.style.setProperty('--spot-y', cy + 'px');
      mask.style.setProperty('--spot-r', rad + 'px');
    }

    function setSpotRect(btn) {
      mask.classList.remove('spot-circle');
      mask.classList.add('spot-rect');
      var r = btn.getBoundingClientRect();
      mask.style.setProperty('--rx1', r.left + 'px');
      mask.style.setProperty('--rx2', r.right + 'px');
      mask.style.setProperty('--ry1', r.top + 'px');
      mask.style.setProperty('--ry2', r.bottom + 'px');
    }

    function placeHint(hint, btn) {
      var r = btn.getBoundingClientRect();
      var cx = r.left + r.width / 2;
      document.body.appendChild(hint);
      var hw = hint.offsetWidth;
      var hh = hint.offsetHeight;
      hint.style.left = Math.max(16, Math.min(cx - hw / 2, window.innerWidth - hw - 16)) + 'px';
      var showBelow = r.top < window.innerHeight * 0.45;
      if (showBelow) {
        hint.style.top = (r.bottom + 18) + 'px';
      } else {
        hint.style.top = (r.top - hh - 18) + 'px';
      }
    }

    // ── Step 1: 播放按钮（圆形聚光灯） ──
    function showStep1() {
      playBtn.classList.add('onboard-target');
      setSpotCircle(playBtn);
      var hint = document.createElement('div');
      hint.className = 'onboard-hint';
      hint.innerHTML = '<div class="ob-text">点我听响</div>';
      placeHint(hint, playBtn);

      // 点播放按钮 → 正常发音（其自身 handler 触发），并进入第二步
      onPlay = function () {
        if (done) return;
        playBtn.classList.remove('onboard-target');
        hint.classList.add('ob-exit');
        setTimeout(function () {
          hint.remove();
          showStep2();
        }, 350);
      };
      playBtn.addEventListener('click', onPlay);
    }

    // ── Step 2: 翻译按钮（矩形聚光灯，1.5 秒后自动进入第三步） ──
    function showStep2() {
      translateBtn.classList.add('onboard-target');
      setSpotRect(translateBtn);
      var hint = document.createElement('div');
      hint.className = 'onboard-hint';
      hint.innerHTML = '<div class="ob-text">连接LLM可用</div>';
      placeHint(hint, translateBtn);

      function finish() {
        if (done) return;
        done = true;
        clearTimeout(autoTimer2);
        translateBtn.classList.remove('onboard-target');
        hint.classList.add('ob-exit');

        // Step 3: 聚光灯打到问号，停留 0.5 秒自动消失
        helpBtn.classList.add('onboard-target');
        setSpotCircle(helpBtn);
        setTimeout(function () {
          helpBtn.classList.remove('onboard-target');
          mask.style.opacity = '0';
          mask.removeEventListener('click', onMask);
          setTimeout(function () {
            hint.remove();
            mask.remove();
            helpBtn.classList.add('onboard-flash');
            setTimeout(function () {
              helpBtn.classList.remove('onboard-flash');
            }, 2000);
          }, 700);
        }, 500);
      }

      // 点翻译按钮 → 立即进入第三步
      onTranslate = function () { finish(); };
      translateBtn.addEventListener('click', onTranslate);
      autoTimer2 = setTimeout(finish, 1500);
    }

    showStep1();
  }

  setTimeout(startOnboarding, 600);
})();
