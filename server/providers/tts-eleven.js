/**
 * ElevenLabs TTS provider.
 * POST https://api.elevenlabs.io/v1/text-to-speech/{voiceId}
 */

async function tts({ text, apiKey, baseUrl, voiceId }) {
  const base = baseUrl || 'https://api.elevenlabs.io';
  const url = `${base.replace(/\/$/, '')}/v1/text-to-speech/${voiceId}`;

  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'xi-api-key': apiKey
      },
      body: JSON.stringify({
        text,
        model_id: 'eleven_multilingual_v2',
        voice_settings: { stability: 0.5, similarity_boost: 0.75 }
      })
    });
  } catch (e) {
    throw Object.assign(new Error(`网络不通，检查网络或地址：${e.message}`), { httpStatus: 502 });
  }

  if (!res.ok) {
    let detail = '';
    try { detail = await res.text(); } catch (_) {}
    const msg = parseElevenError(res.status, detail);
    throw Object.assign(new Error(msg), { httpStatus: 502 });
  }

  const buf = Buffer.from(await res.arrayBuffer());
  return buf.toString('base64');
}

function parseElevenError(status, detail) {
  switch (status) {
    case 401:
      return 'API Key 无效，请检查 ElevenLabs 的 Key';
    case 404:
      return '音色找不到，请检查音色 ID';
    case 422:
      return `参数有误：${detail.slice(0, 200)}`;
    case 429:
      return '请求太频繁，被限流了，稍等一会儿再试';
    default:
      return `语音服务返回错误(${status})，稍后重试`;
  }
}

module.exports = { tts };
