/**
 * Kokoro TTS 原生 Node.js 引擎（无 Python、无 HTTP 跨进程调用）
 *
 * 使用 kokoro-js (ONNX Runtime) 在 Node.js 进程内直接加载模型并合成语音。
 * 模型在服务启动时加载一次，常驻内存，后续调用直接生成。
 */

const { KokoroTTS } = require('kokoro-js');
const path = require('path');
const fs = require('fs');

const MODEL_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX';
const DTYPE = 'q8';        // 量化精度：q8 平衡质量与体积 (~100MB)
const DEVICE = 'cpu';      // Node.js 环境用 CPU

let _tts = null;
let _loading = null;

// ── 补全中/日/法等非英文音色到 VOICES 元数据 ──
// kokoro-js 默认 VOICES 只含 28 个英文音色，但 .bin 文件包含全部 54 个
const EXTRA_VOICES = {
  // 中文
  zf_xiaobei: { name: 'Xiaobei', language: 'zh', gender: 'Female' },
  zf_xiaoni:  { name: 'Xiaoni',  language: 'zh', gender: 'Female' },
  zf_xiaoxiao:{ name: 'Xiaoxiao',language: 'zh', gender: 'Female' },
  zf_xiaoyi:  { name: 'Xiaoyi',  language: 'zh', gender: 'Female' },
  zm_yunjian: { name: 'Yunjian', language: 'zh', gender: 'Male' },
  zm_yunxi:   { name: 'Yunxi',   language: 'zh', gender: 'Male' },
  zm_yunxia:  { name: 'Yunxia',  language: 'zh', gender: 'Male' },
  zm_yunyang: { name: 'Yunyang', language: 'zh', gender: 'Male' },
  // 日语
  jf_alpha:       { name: 'Alpha',       language: 'ja', gender: 'Female' },
  jf_gongitsune:  { name: 'Gongitsune',  language: 'ja', gender: 'Female' },
  jf_nezumi:      { name: 'Nezumi',      language: 'ja', gender: 'Female' },
  jf_tebukuro:    { name: 'Tebukuro',    language: 'ja', gender: 'Female' },
  jm_kumo:        { name: 'Kumo',        language: 'ja', gender: 'Male' },
  // 其他语言
  ef_dora:  { name: 'Dora', language: 'es', gender: 'Female' },
  em_alex:  { name: 'Alex', language: 'es', gender: 'Male' },
  em_santa: { name: 'Santa',language: 'es', gender: 'Male' },
  ff_siwis: { name: 'Siwis',language: 'fr', gender: 'Female' },
  hf_alpha: { name: 'Alpha',language: 'hi', gender: 'Female' },
  hf_beta:  { name: 'Beta', language: 'hi', gender: 'Female' },
  hm_omega: { name: 'Omega',language: 'hi', gender: 'Male' },
  hm_psi:   { name: 'Psi',  language: 'hi', gender: 'Male' },
  if_sara:  { name: 'Sara', language: 'it', gender: 'Female' },
  im_nicola:{ name: 'Nicola',language: 'it',gender: 'Male' },
  pf_dora:  { name: 'Dora', language: 'pt', gender: 'Female' },
  pm_alex:  { name: 'Alex', language: 'pt', gender: 'Male' },
  pm_santa: { name: 'Santa',language: 'pt', gender: 'Male' },
  bf_lily:  { name: 'Lily', language: 'en-gb', gender: 'Female' },
  bm_adam:  { name: 'Adam', language: 'en-gb', gender: 'Male' },
};

/**
 * 加载 Kokoro 模型（单例，只加载一次）
 * @param {Function} progressCb 下载进度回调
 * @returns {Promise<KokoroTTS>}
 */
async function loadModel(progressCb) {
  if (_tts) return _tts;
  if (_loading) return _loading;

  _loading = (async () => {
    console.log('[Kokoro-Native] 正在加载模型 (dtype=' + DTYPE + ', device=' + DEVICE + ')...');
    const start = Date.now();

    _tts = await KokoroTTS.from_pretrained(MODEL_ID, {
      dtype: DTYPE,
      device: DEVICE,
      progress_callback: (info) => {
        if (info.status === 'progress' && info.file?.includes('model')) {
          const pct = (info.progress || 0).toFixed(0);
          if (pct % 10 === 0) console.log(`[Kokoro-Native] 模型下载: ${pct}%`);
        } else if (info.status === 'done') {
          console.log(`[Kokoro-Native] 模型加载完成 (${((Date.now() - start) / 1000).toFixed(1)}s)`);
        }
      }
    });

    // 补全非英文音色
    const voices = _tts.voices;
    for (const [id, meta] of Object.entries(EXTRA_VOICES)) {
      if (!voices[id]) {
        // 直接修改内部 VOICES 对象（Object.freeze 不影响已冻结对象属性检查）
        // kokoro-js 的 _validate_voice 用 hasOwnProperty 检查，我们通过原型链注入
      }
    }

    // 猴子补丁：扩展 _validate_voice 以支持所有 .bin 音色文件
    // kokoro-js 的 .bin 音色文件可能在与主入口文件同级或上一级的 voices/ 目录
    const entryDir = path.dirname(require.resolve('kokoro-js'));
    const voicesDir = [path.join(entryDir, 'voices'), path.join(entryDir, '..', 'voices')]
      .find(p => fs.existsSync(p));
    if (voicesDir) {
      const voiceFiles = fs.readdirSync(voicesDir).filter(f => f.endsWith('.bin'));
      const allVoiceIds = new Set([...Object.keys(voices), ...voiceFiles.map(f => f.replace('.bin', ''))]);
      const origValidate = _tts._validate_voice.bind(_tts);
      _tts._validate_voice = function(voiceId) {
        if (allVoiceIds.has(voiceId)) {
          return voiceId.charAt(0); // 返回语言前缀字母
        }
        return origValidate(voiceId);
      };
      console.log(`[Kokoro-Native] 音色总数: ${allVoiceIds.size} (内置 ${Object.keys(voices).length} + 扩展 ${allVoiceIds.size - Object.keys(voices).length})`);
    }

    console.log('[Kokoro-Native] 引擎就绪 ✓');
    return _tts;
  })();

  return _loading;
}

/**
 * 获取已加载的模型实例（须在 loadModel 完成后调用）
 */
function getModel() {
  return _tts;
}

/**
 * 根据音色 ID 前缀推断语言
 * a-prefix/b-prefix = 英语, z-prefix = 中文, j-prefix = 日语, etc.
 */
function getVoiceLanguage(voiceId) {
  if (!voiceId || voiceId.length < 1) return 'en';
  const prefix = voiceId.charAt(0).toLowerCase();
  const langMap = { a: 'en', b: 'en', z: 'zh', j: 'ja', e: 'es', f: 'fr', h: 'hi', i: 'it', p: 'pt' };
  return langMap[prefix] || 'en';
}

/**
 * 清洗文本：英语音色遇到中文/日文字符时自动剔除
 * Kokoro 英文模型无法处理 CJK 字符，会反复读同一字符
 */
function sanitizeTextForVoice(text, voiceId) {
  const lang = getVoiceLanguage(voiceId);
  if (lang === 'en') {
    // 剔除所有 CJK 字符（汉字、假名、全角符号）
    const cleaned = text
      .replace(/[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff\u3040-\u309f\u30a0-\u30ff\u3000-\u303f\uff00-\uffef]/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim();
    if (cleaned !== text) {
      console.log(`[Kokoro-Native] 英语音色剔除 CJK 字符: "${text.substring(0, 40)}..." → "${cleaned.substring(0, 40)}..."`);
    }
    return cleaned;
  }
  return text;
}

/**
 * 合成语音 — 在 Node.js 进程内直接调用 ONNX 模型
 * @param {string} text 要朗读的文本
 * @param {string} voice 音色 ID (如 af_heart)
 * @param {number} speed 语速 (0.5-2.0)
 * @returns {Promise<{wavBuffer: Buffer, mime: string}>}
 */
async function synthesize(text, voice = 'af_nicole', speed = 1.0) {
  if (!_tts) {
    throw new Error('Kokoro 模型未加载，请先调用 loadModel()');
  }

  // 英语音色自动剔除 CJK 字符，避免循环重复
  const cleanText = sanitizeTextForVoice(text, voice);
  if (!cleanText) {
    throw new Error('文本不含该音色可读的内容（英语音色无法朗读中文）');
  }

  const t0 = Date.now();
  const audio = await _tts.generate(cleanText, {
    voice: voice,
    speed: speed
  });

  const elapsed = ((Date.now() - t0) / 1000).toFixed(2);
  console.log(`[Kokoro-Native] 合成完成: voice=${voice}, speed=${speed}, ${elapsed}s, ${cleanText.length}字`);

  // toWav() 返回 ArrayBuffer
  const wavArrayBuffer = audio.toWav();
  const wavBuffer = Buffer.from(wavArrayBuffer);

  return {
    wavBuffer,
    mime: 'audio/wav'
  };
}

/**
 * 获取所有可用音色列表
 */
function listVoices() {
  if (!_tts) return [];
  return Object.keys(_tts.voices);
}

module.exports = { loadModel, getModel, synthesize, listVoices };
