/**
 * OpenAI 兼容 TTS 适配器
 * 标准接口：POST {baseUrl}/v1/audio/speech
 * 覆盖：OpenAI 官方、Azure OpenAI、本地 OpenAI 兼容服务、部分国产模型网关
 *
 * ── 如何新增其他 TTS 服务商（MiniMax/阿里云/腾讯云/讯飞/Azure 等）──────────────
 * 1. 在 providers/ 下新建 tts-xxx.js，导出 async function tts({ text, apiKey, baseUrl, voiceId })
 * 2. 在 server/index.js 的 switch(provider) 中加一个 case，调用对应模块
 * 3. 所有适配器对前端统一返回 audioBase64（已转 base64 的 mp3 二进制）
 * 4. 参考下方 elevenLabs / openai 的实现模式即可
 */

async function tts({ text, apiKey, baseUrl, voiceId, model }) {
  if (!baseUrl) throw Object.assign(new Error('请先填写 Base URL'), { httpStatus: 400 });
  if (!apiKey) throw Object.assign(new Error('请先填写 API Key'), { httpStatus: 400 });

  const url = `${baseUrl.replace(/\/$/, '')}/v1/audio/speech`;
  const body = {
    model: model || 'tts-1',
    input: text,
    voice: voiceId || 'alloy',
    response_format: 'mp3',
    speed: 1.0
  };

  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify(body)
    });
  } catch (e) {
    throw Object.assign(new Error(`网络不通，检查网络或地址：${e.message}`), { httpStatus: 502 });
  }

  if (!res.ok) {
    let detail = ''; try { detail = await res.text(); } catch (_) {}
    const map = { 401: 'API Key 无效，请检查', 429: '请求太频繁，被限流了，稍等一会儿再试', 503: '语音服务过载，请稍后重试' };
    const msg = map[res.status] || `语音服务返回错误(${res.status})，稍后重试`;
    throw Object.assign(new Error(msg), { httpStatus: 502 });
  }

  const buf = Buffer.from(await res.arrayBuffer());
  return buf.toString('base64');
}

module.exports = { tts };
