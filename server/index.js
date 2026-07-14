require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { translate } = require('./providers/llm');
const minimaxTts = require('./providers/tts-minimax');
const elevenTts = require('./providers/tts-eleven');
const kokoroTts = require('./providers/tts-kokoro');
const openaiTts = require('./providers/tts-openai');
const { analyze } = require('./providers/analyze');
const { loadModel: loadKokoro, getModel: getKokoro } = require('./kokoro-native');

const app = express();
const PORT = process.env.PORT || 3000;

// 网页版：允许所有来源访问（用户在各填各 Key 的模式下，没有敏感数据风险）
app.use(cors());
app.use(express.json({ limit: '10mb' }));

app.get('/api/health', (req, res) => {
  const kokoroReady = !!getKokoro();
  res.json({ ok: true, kokoro: kokoroReady });
});

app.post('/api/translate', async (req, res) => {
  try {
    const { text, llm } = req.body || {};
    if (!text || typeof text !== 'string') {
      return res.status(400).json({ error: '缺少要翻译的文本' });
    }
    const result = await translate({
      text,
      apiKey: llm?.apiKey,
      baseUrl: llm?.baseUrl,
      model: llm?.model
    });
    res.json(result);
  } catch (e) {
    const status = e.httpStatus || 500;
    const payload = { error: e.message || '服务器内部错误' };
    if (e.rawContent) payload.rawContent = e.rawContent;
    res.status(status).json(payload);
  }
});


app.post('/api/analyze', async (req, res) => {
  try {
    const { text, llm } = req.body || {};
    if (!text || typeof text !== 'string') {
      return res.status(400).json({ error: '缺少要拆分的文本' });
    }
    const result = await analyze({
      text,
      apiKey: llm?.apiKey,
      baseUrl: llm?.baseUrl,
      model: llm?.model
    });
    res.json(result);
  } catch (e) {
    const status = e.httpStatus || 500;
    const payload = { error: e.message || '服务器内部错误' };
    if (e.rawContent) payload.rawContent = e.rawContent;
    res.status(status).json(payload);
  }
});

app.post('/api/tts', async (req, res) => {
  try {
    const { text, provider, tts } = req.body || {};
    if (!text || typeof text !== 'string') {
      return res.status(400).json({ error: '缺少要朗读的文本' });
    }
    const apiKey = tts?.apiKey || process.env.TTS_API_KEY || '';
    // Kokoro 是内置引擎，不需要 API key
    if (!apiKey && provider !== 'kokoro') {
      return res.status(400).json({ error: '请先在设置里填入 TTS API Key' });
    }
    const baseUrl = tts?.baseUrl || process.env.TTS_BASE_URL || '';
    const voiceId = tts?.voiceId || process.env.TTS_VOICE_ID || '';
    const model = tts?.model || '';
    const speed = tts?.speed || 1.0;

    let audioBase64;
    let mime = 'audio/mpeg';
    // 按服务商分发
    switch (provider || 'kokoro') {
      case 'minimax':
        audioBase64 = await minimaxTts.tts({ text, apiKey, baseUrl, voiceId, provider: tts || {} });
        break;
      case 'openai':
        audioBase64 = await openaiTts.tts({ text, apiKey, baseUrl, voiceId, model });
        break;
      case 'kokoro':
        audioBase64 = await kokoroTts.tts({ text, voiceId, speed });
        mime = 'audio/wav';
        break;
      case 'elevenlabs':
      default:
        audioBase64 = await elevenTts.tts({ text, apiKey, baseUrl, voiceId, model });
        break;
    }

    if (!audioBase64) {
      return res.status(502).json({ error: '语音合成失败，没有返回音频' });
    }
    res.json({ audioBase64, mime });
  } catch (e) {
    const status = e.httpStatus || 500;
    res.status(status).json({ error: e.message || '语音合成失败' });
  }
});

app.use(express.static(path.join(__dirname, '..', 'public')));

// ── 启动服务 ──────────────────────────────
async function start() {
  // 启动时加载 Kokoro 模型（异步，不阻塞 HTTP 服务）
  loadKokoro().catch(err => {
    console.error('[Kokoro-Native] 模型加载失败:', err.message);
    console.error('[Kokoro-Native] TTS 功能将不可用，请检查网络连接（首次需从 HuggingFace 下载模型）');
  });

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`线上情景英语 server running on port ${PORT}`);
    console.log('[Kokoro] 模型正在后台加载...（首次启动需下载约100MB模型）');
  });
}

start();
