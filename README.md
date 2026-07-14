# 线上情景英语

打开网址即用的英语学习卡片工具：输入中文 → LLM 生成地道英文口播 + 英式音标 + 固定搭配 + 悬停释义 → Kokoro TTS 逐句朗读 → 导出离线 HTML。

**纯网页版，无需下载安装。** 服务器端运行 Kokoro TTS，用户各填各的 LLM Key。

> **开源与许可**：本项目的语音合成能力基于他人开源成果。完整来源、版权与许可证见 **[THIRD-PARTY-NOTICES.md](./THIRD-PARTY-NOTICES.md)**。本项目自身以 **Apache-2.0** 发布（见 [LICENSE](./LICENSE)）。

---

## 在线使用

直接打开网址（部署后填入）：

```
https://你的空间名.hf.space
```

### 使用流程

1. 打开页面右上角「连接设置」：
   - **LLM**：填 OpenAI 兼容接口的 API Key / Base URL / 模型名，点「连接」，状态灯变绿即可。
   - **TTS**：默认就是 **Kokoro（服务器端）**，免费、无需 Key。
2. 输入框输入中文场景描述（例：「我在磨咖啡豆，准备手冲」），点「生成卡片」。
3. 逐句点播放按钮听发音；单词可悬停看释义。
4. 点「导出」，得到单个 `.html` 文件：内嵌已缓存音频，断网可播、不含任何 Key。

---

## 本地开发

```bash
cd 线上情景英语
npm install
npm start
# → 浏览器打开 http://localhost:3000
```

---

## 部署到 Hugging Face Spaces（免费）

1. 在 https://huggingface.co 注册账号
2. 点右上角 → New Space
   - Name: `online-situational-english`（或任意名）
   - SDK: **Docker**
   - Visibility: Public（免费版必须公开）
3. 把本仓库代码推上去（git push 到 HF 的仓库地址）
4. 等几分钟自动构建，完成后会得到 `https://你的用户名-online-situational-english.hf.space`

> 为什么选 HF Spaces？免费 16GB 内存，足够跑 Kokoro TTS 模型（峰值约 800MB）。Render/Vercel 免费版只有 512MB，跑不动。

---

## 目录结构

```
线上情景英语/
  server/
    index.js                  # Express 入口：/api/translate /api/tts /api/analyze
    kokoro-native.js          # 服务器端 Kokoro 引擎
    providers/
      llm.js                  # OpenAI 兼容 LLM 调用
      analyze.js              # 音标/释义分析
      tts-kokoro.js           # Kokoro TTS
      tts-minimax.js / tts-eleven.js / tts-openai.js
    .env.example
  public/
    index.html                # 卡片 UI
    app.js                    # 渲染、播放、缓存、导出逻辑
    THIRD-PARTY-NOTICES.md    # 界面可访问的许可声明
  Dockerfile                  # HF Spaces / Docker 部署
  package.json
  LICENSE
  THIRD-PARTY-NOTICES.md
```

## 隐私 & 安全

- 所有 LLM API Key 只存前端内存变量（不写 localStorage），关闭页面即清空。
- 服务器不存储任何用户数据或 Key。
- Kokoro TTS 完全在服务器端运行，不上传任何音频到第三方。
- 导出的离线 HTML 内嵌已缓存音频（base64），不含任何 Key。

---

## 开源与致谢

| 组件 | 作用 | 许可证 | 来源 |
|------|------|--------|------|
| **Kokoro-82M** | TTS 引擎 | Apache-2.0 | [hexgrad/kokoro](https://github.com/hexgrad/kokoro) |
| **kokoro-js** | Node 封装 | Apache-2.0 | [npm](https://www.npmjs.com/package/kokoro-js) |
| **@huggingface/transformers** | 推理运行时 | Apache-2.0 | [transformers.js](https://github.com/huggingface/transformers.js) |
| **onnxruntime-web** | 模型执行 | MIT | Microsoft |
| express / cors / dotenv | 后端框架 | MIT | — |

本项目自身以 **[Apache-2.0](./LICENSE)** 发布。
