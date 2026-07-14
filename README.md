# 线上情景英语

打开网址即用的英语学习卡片工具：输入中文 → LLM 生成地道英文口播 + 英式音标 + 固定搭配 + 悬停释义 → Kokoro TTS 逐句朗读 → 导出离线 HTML。

**纯网页版，无需下载安装。** 服务器端运行 Kokoro TTS，用户各填各的 LLM Key。

> **开源与许可**：本项目基于他人开源成果。完整来源、版权与许可证见 **[THIRD-PARTY-NOTICES.md](./THIRD-PARTY-NOTICES.md)**。本项目自身以 **Apache-2.0** 发布（见 [LICENSE](./LICENSE)）。

---

## 在线使用

部署完成后，任何人打开网址即可使用：

1. 右上角「连接设置」→ 填自己的 LLM API Key / Base URL / 模型名
2. 输入中文场景（例：「我在磨咖啡豆，准备手冲」）→ 点「生成卡片」
3. 逐句点播放听发音 → 可导出离线 HTML

---

## 部署到 Modal.com（免费）

### 为什么用 Modal？

| 平台 | 免费内存 | 跑得动 Kokoro？ | 备注 |
|------|---------|----------------|------|
| Render | 512MB | ⚠️ 紧张 | Kokoro 峰值约 800MB |
| HF Spaces Docker | 16GB | ✅ | **需付费 $9/月** |
| **Modal** | **2GB** | ✅ | **免费 $30/月额度** |

Modal 免费额度：$30/月，约等于 **2GB 内存容器跑 50 小时**（每天约 1.7 小时活跃使用）。不用绑卡。

### 部署步骤

**1. 注册 Modal 账号**

打开 https://modal.com/signup ，用邮箱注册（不需要信用卡）。

**2. 在本机安装 Modal CLI**

```bash
pip install modal
```

> Mac 用户如果没有 pip，用 `pip3 install modal` 或 `python3 -m pip install modal`。

**3. 登录认证**

```bash
modal token new
```

会打开浏览器，点确认即可。

**4. 部署**

```bash
cd 线上情景英语
modal deploy modal_app.py
```

部署成功后，终端会输出一个网址，形如：

```
https://ayunyl--online-situational-english-serve.modal.run
```

打开就是你的网页版了。任何人访问这个网址即可使用。

### 关于冷启动

Modal 免费版不常驻容器——几分钟没人访问会自动关停，下次有人打开时自动重启（约 15-30 秒），首次需下载 Kokoro 模型（后续从持久卷读取，约 2 秒）。

---

## 本地开发

```bash
cd 线上情景英语
npm install
npm start
# → 浏览器打开 http://localhost:3000
```

---

## 目录结构

```
线上情景英语/
  modal_app.py               # Modal.com 部署入口（Python ASGI 代理 → Node.js）
  Dockerfile                 # 通用 Docker 部署（备用）
  server/
    index.js                  # Express 入口：/api/translate /api/tts /api/analyze
    kokoro-native.js          # 服务器端 Kokoro 引擎
    providers/
      llm.js / analyze.js / tts-kokoro.js / tts-minimax.js / tts-eleven.js / tts-openai.js
    .env.example
  public/
    index.html                # 卡片 UI
    app.js                    # 渲染、播放、缓存、导出逻辑
    THIRD-PARTY-NOTICES.md
  package.json
  LICENSE
  THIRD-PARTY-NOTICES.md
```

## 隐私 & 安全

- LLM API Key 只存浏览器内存，关闭页面即清空，服务器不存储。
- Kokoro TTS 在服务器端运行，不上传音频到第三方。
- 导出的离线 HTML 内嵌音频（base64），不含任何 Key。
