/**
 * 浏览器端 Kokoro TTS 引擎
 * 使用 transformers.js + onnxruntime-web 在浏览器本地合成语音
 * 
 * 加载顺序：在 app.js 之前加载此脚本（type="module"）
 */

import { env } from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/+esm";
import { KokoroTTS } from "https://cdn.jsdelivr.net/npm/kokoro-js@1.2.1/+esm";

// 走 Cloudflare Workers 代理 → hf-mirror.com 国内镜像（有 CORS 头 + 国内速度）
const HF_PROXY = "https://ayunyl.yjnrich.workers.dev";
env.remoteHost = HF_PROXY;
env.remotePathTemplate = "{model}/resolve/{revision}/";
window.process = window.process || { env: {} };
window.process.env.HF_ENDPOINT = HF_PROXY;

// ONNX Runtime WASM 路径
env.backends = env.backends || {};
env.backends.onnx = env.backends.onnx || {};
env.backends.onnx.wasm = env.backends.onnx.wasm || {};
env.backends.onnx.wasm.wasmPaths = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/";

const MODEL_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX';

let _tts = null;
let _loading = null;
let _device = null;
let _dtype = null;
let _isMobile = null;

// 检测是否为手机（只用 user agent，不用窗口宽度——开了 DevTools 会变窄误判）
function detectMobile() {
  if (_isMobile !== null) return _isMobile;
  _isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
  return _isMobile;
}
// 检测 WebGPU 支持
async function detectDevice() {
  if (_device) return { device: _device, dtype: _dtype };
  try {
    const adapter = await navigator.gpu?.requestAdapter();
    if (adapter) {
      _device = 'webgpu';
      _dtype = 'fp32';
      console.log('[Kokoro-Browser] 使用 WebGPU 加速');
    } else {
      _device = 'wasm';
      _dtype = 'q8';
      console.log('[Kokoro-Browser] 使用 WASM (CPU)');
    }
  } catch (e) {
    _device = 'wasm';
    _dtype = 'q8';
    console.log('[Kokoro-Browser] WebGPU 不可用，使用 WASM');
  }
  return { device: _device, dtype: _dtype };
}

/**
 * 加载模型（单例）
 * @param {Function} progressCb - 进度回调 (percent, file)
 * @returns {Promise<KokoroTTS>}
 */
async function loadModel(progressCb, forceLoad) {
  if (_tts) return _tts;
  if (_loading) return _loading;

  // 手机不自动加载（省流量），但允许手动加载
  if (detectMobile() && !forceLoad) {
    console.log('[Kokoro-Browser] 手机设备，跳过自动加载（可手动切换到 Kokoro 试用）');
    return null;
  }

  _loading = (async () => {
    const { device, dtype } = await detectDevice();
    console.log(`[Kokoro-Browser] 正在加载模型 (dtype=${dtype}, device=${device})...`);
    const start = Date.now();

    _tts = await KokoroTTS.from_pretrained(MODEL_ID, {
      dtype,
      device,
      progress_callback: (info) => {
        if (info.status === 'progress' && info.file?.includes('model')) {
          const pct = (info.progress || 0).toFixed(0);
          if (progressCb) progressCb(pct, info.file);
        }
      }
    });

    console.log(`[Kokoro-Browser] 模型加载完成 (${((Date.now() - start) / 1000).toFixed(1)}s)`);
    return _tts;
  })();

  return _loading;
}

/**
 * 获取已加载的模型
 */
function getModel() {
  return _tts;
}

/**
 * 模型是否已加载
 */
function isReady() {
  return !!_tts;
}

/**
 * 是否支持 Kokoro（非手机）
 */
function isSupported() {
  return !detectMobile();
}

/**
 * 根据音色 ID 前缀推断语言
 */
function getVoiceLanguage(voiceId) {
  if (!voiceId || voiceId.length < 1) return 'en';
  const prefix = voiceId.charAt(0).toLowerCase();
  const langMap = { a: 'en', b: 'en', z: 'zh', j: 'ja', e: 'es', f: 'fr', h: 'hi', i: 'it', p: 'pt' };
  return langMap[prefix] || 'en';
}

/**
 * 清洗文本：英语音色遇到 CJK 字符时自动剔除
 */
function sanitizeTextForVoice(text, voiceId) {
  const lang = getVoiceLanguage(voiceId);
  if (lang === 'en') {
    return text
      .replace(/[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff\u3040-\u309f\u30a0-\u30ff\u3000-\u303f\uff00-\uffef]/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }
  return text;
}

/**
 * 合成语音
 * @param {string} text - 要朗读的文本
 * @param {string} voice - 音色 ID
 * @param {number} speed - 语速
 * @returns {Promise<{b64: string, mime: string} | null>}
 */
async function synthesize(text, voice = 'af_nicole', speed = 1.0) {
  if (!_tts) {
    throw new Error('Kokoro 模型未加载');
  }

  // 英语音色剔除 CJK
  const cleanText = sanitizeTextForVoice(text, voice);
  if (!cleanText) {
    throw new Error('文本不含该音色可读的内容');
  }

  const t0 = Date.now();
  const audio = await _tts.generate(cleanText, { voice, speed });
  const elapsed = ((Date.now() - t0) / 1000).toFixed(2);
  console.log(`[Kokoro-Browser] 合成完成: voice=${voice}, ${elapsed}s, ${cleanText.length}字`);

  // 转 base64
  const wav = audio.toWav();
  const b64 = bufferToBase64(wav);
  return { b64, mime: 'audio/wav' };
}

/**
 * ArrayBuffer → base64
 */
function bufferToBase64(buffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

// 导出到全局
window.KokoroBrowser = {
  loadModel,       // loadModel(progressCb, forceLoad) — forceLoad=true 时手机也会加载
  getModel,
  isReady,
  isSupported,     // 是否非手机（自动加载用）
  isMobile: detectMobile,  // 是否手机
  synthesize,
  detectDevice,
};

console.log('[Kokoro-Browser] 模块已加载，等待初始化...');
