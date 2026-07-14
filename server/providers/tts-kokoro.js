/**
 * Kokoro TTS provider — 原生 Node.js 引擎（无 HTTP 调用）
 *
 * 直接在进程内调用 ONNX 模型合成语音，不依赖外部 Python 服务。
 */

const { synthesize, getModel } = require('../kokoro-native');

async function tts({ text, voiceId, speed }) {
  if (!getModel()) {
    throw Object.assign(
      new Error('Kokoro 引擎还在加载中，等一会儿再试'),
      { httpStatus: 503 }
    );
  }

  const voice = voiceId || 'af_nicole';
  const spd = speed || 1.0;

  const { wavBuffer } = await synthesize(text, voice, spd);
  return wavBuffer.toString('base64');
}

module.exports = { tts };
