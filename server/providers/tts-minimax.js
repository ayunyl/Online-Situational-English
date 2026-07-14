/**
 * MiniMax TTS provider.
 * 优先走同步接口；若失败退回异步（async task）。
 */

const POLL_INTERVAL_MS = 1500;
const POLL_MAX_ATTEMPTS = 40; // 最长 ~60s

async function trySync({ text, apiKey, baseUrl, voiceId, provider }) {
  const url = `${baseUrl.replace(/\/$/, '')}/v1/t2a_v2`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: 'speech-02-turbo',
      text,
      voice_setting: { voice_id: voiceId, speed: 1.0 },
      audio_setting: { format: 'mp3' },
      language_boost: 'English',
      ...(provider?.extraBody || {})
    })
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    const map = { 401: 'API Key 无效，请检查', 429: '请求太频繁，被限流了，稍等一会儿再试' };
    const msg = map[res.status] || `MiniMax 返回错误(${res.status})，稍后重试`;
    throw Object.assign(new Error(msg), { httpStatus: 502 });
  }

  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('audio') || contentType.includes('octet-stream')) {
    // 直接返回二进制
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.toString('base64');
  }

  // 如果返回 JSON（某些网关包装）
  let json;
  try { json = await res.json(); } catch (_) {}
  if (json?.data?.audio) {
    // hex-encoded audio
    return Buffer.from(json.data.audio, 'hex').toString('base64');
  }
  if (json?.audio_url || json?.audioUrl) {
    const audioUrl = json.audio_url || json.audioUrl;
    const audioRes = await fetch(audioUrl);
    if (!audioRes.ok) throw Object.assign(new Error('音频文件下载失败'), { httpStatus: 502 });
    const buf = Buffer.from(await audioRes.arrayBuffer());
    return buf.toString('base64');
  }

  throw Object.assign(new Error('MiniMax 返回格式异常'), { httpStatus: 502 });
}

async function submitAsync({ text, apiKey, baseUrl, voiceId, provider }) {
  const url = `${baseUrl.replace(/\/$/, '')}/v3/async/minimax-speech-02-turbo`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: 'speech-02-turbo',
      text,
      voice_setting: { voice_id: voiceId, speed: 1.0 },
      audio_setting: { format: 'mp3' },
      language_boost: 'English',
      ...(provider?.extraBody || {})
    })
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw Object.assign(
      new Error(`MiniMax 提交任务失败(${res.status})，稍后重试`),
      { httpStatus: 502 }
    );
  }

  const json = await res.json();
  return json.task_id || json.taskId;
}

async function pollResult({ taskId, apiKey, baseUrl }) {
  const url = `${baseUrl.replace(/\/$/, '')}/v3/async/task/${taskId}`;

  for (let i = 0; i < POLL_MAX_ATTEMPTS; i++) {
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));

    const res = await fetch(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}` }
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw Object.assign(
        new Error(`MiniMax 查询进度失败(${res.status})，稍后重试`),
        { httpStatus: 502 }
      );
    }

    const json = await res.json();
    const status = json.status || json.task_status;

    if (status === 'TASK_STATUS_SUCCEED' || status === 'SUCCESS' || status === 'succeed') {
      const audioUrl = json.audios?.[0]?.audio_url
        || json.audios?.[0]?.audioUrl
        || json.audio_url
        || json.audioUrl;
      if (!audioUrl) {
        throw Object.assign(new Error('MiniMax 任务完成但没有返回音频'), { httpStatus: 502 });
      }
      // 下载音频（24h 有效）
      const audioRes = await fetch(audioUrl);
      if (!audioRes.ok) throw Object.assign(new Error('音频文件下载失败'), { httpStatus: 502 });
      const buf = Buffer.from(await audioRes.arrayBuffer());
      return buf.toString('base64');
    }

    if (status === 'TASK_STATUS_FAILED' || status === 'FAIL' || status === 'failed') {
      throw Object.assign(new Error(`MiniMax 任务失败，稍后重试`), { httpStatus: 502 });
    }
    // else: still processing, continue polling
  }

  throw Object.assign(new Error('MiniMax 等待超时，合成时间太长了'), { httpStatus: 504 });
}

async function tts({ text, apiKey, baseUrl, voiceId, provider }) {
  // 1) 尝试同步
  try {
    const b64 = await trySync({ text, apiKey, baseUrl, voiceId, provider });
    return b64;
  } catch (syncErr) {
    // 同步失败 → 退回异步
    console.warn('[TTS MiniMax] sync failed, falling back to async:', syncErr.message);
  }

  // 2) 异步兜底
  const taskId = await submitAsync({ text, apiKey, baseUrl, voiceId, provider });
  return pollResult({ taskId, apiKey, baseUrl });
}

module.exports = { tts };
