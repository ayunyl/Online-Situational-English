FROM node:22-slim

WORKDIR /app

# 安装系统依赖（onnxruntime 需要）
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgomp1 \
    && rm -rf /var/lib/apt/lists/*

# 先复制 package 文件，利用 Docker 缓存
COPY package.json package-lock.json* ./

RUN npm ci --production || npm install --production

# 复制源码
COPY server/ ./server/
COPY public/ ./public/
COPY LICENSE THIRD-PARTY-NOTICES.md ./

# 环境变量
ENV PORT=7860
ENV NODE_ENV=production

EXPOSE 7860

CMD ["node", "server/index.js"]
