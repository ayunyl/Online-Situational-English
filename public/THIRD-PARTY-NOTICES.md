# 第三方许可声明 / Third-Party Notices

本项目「融合版情景英语」在语音合成（TTS）与后端能力上，复用了以下开源组件。
根据各组件许可证（Apache-2.0 / MIT）的要求，在此对其来源、版权与许可证予以明示。

---

## 1. 语音合成模型 —— Kokoro-82M

- **组件**：Kokoro-82M / Kokoro-82M-v1.0-ONNX（运行时由应用自动从 Hugging Face 下载）
- **作者 / 来源**：hexgrad
- **仓库**：<https://github.com/hexgrad/kokoro>
- **模型卡**：<https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX>
- **许可证**：**Apache License 2.0**
- **商用 / 再分发**：允许（含商业用途）。本应用**不捆绑**模型权重，由终端用户在首次使用时自行从 Hugging Face 拉取；使用时请遵守其 Apache-2.0 许可。

## 2. kokoro-js（Node.js 封装调用库）

- **版本**：1.2.1
- **作者**：hexgrad (hello@hexgrad.com)
- **仓库**：<https://github.com/hexgrad/kokoro> · npm: <https://www.npmjs.com/package/kokoro-js>
- **许可证**：**Apache License 2.0**
- 完整文本见本仓库 `node_modules/kokoro-js/LICENSE`，或 <http://www.apache.org/licenses/LICENSE-2.0>。

## 3. @huggingface/transformers（端内推理运行时）

- **版本**：3.8.1
- **作者**：Hugging Face
- **仓库**：<https://github.com/huggingface/transformers.js>
- **许可证**：**Apache License 2.0**
- 完整文本见本仓库 `node_modules/@huggingface/transformers/LICENSE`。

## 4. onnxruntime-web（模型执行引擎）

- **版本**：1.22.0-dev
- **作者**：Microsoft
- **许可证**：**MIT License**
- 完整文本见本仓库 `node_modules/onnxruntime-web/LICENSE`。

## 5. 后端依赖

| 组件 | 版本 | 许可证 |
|------|------|--------|
| express | 4.22.2 | MIT |
| cors | 2.8.6 | MIT |
| dotenv | 16.6.1 | BSD-2-Clause |

以上 MIT / BSD 许可完整文本见各自 `node_modules/<组件>/LICENSE`。

---

## 本项目（融合版情景英语）许可证

本项目自身以 **Apache License 2.0** 发布，见仓库根目录 `LICENSE` 文件。

> **署名要求提示**：Apache-2.0 与 MIT 均要求在使用、修改、再分发时保留上述原作者的版权与许可证声明。本项目已在此文件中集中列示，并在应用界面底部标注「语音合成基于 Kokoro」。若你对本项目进行了修改并再分发，请保留本文件及原许可证文本。
