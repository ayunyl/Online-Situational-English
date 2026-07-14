"""
线上情景英语 — Modal.com 部署入口

原理：Modal 容器内启动 Node.js Express 服务器（子进程），
Python ASGI 代理把所有 HTTP 请求转发给它。
用户打开 Modal 给的网址 → Modal 代理 → Express → 返回页面 / API 响应。

部署命令（在项目根目录执行）：
    pip install modal
    modal token new
    modal deploy modal_app.py
"""

import modal
import subprocess
import os
import time
import httpx
from starlette.applications import Starlette
from starlette.routing import Route
from starlette.responses import Response
from starlette.requests import Request

app = modal.App("online-situational-english")

# 持久化卷：缓存 Kokoro 模型，避免每次冷启动都重新下载 82MB
model_cache = modal.Volume.from_name("kokoro-model-cache", create_if_missing=True)

# Docker 镜像：Node.js + Python（Modal 需要 Python 运行 ASGI 代理）
image = (
    modal.Image.from_registry("node:22-slim")
    .apt_install("libgomp1")          # onnxruntime 需要
    .copy_local_dir(".", "/app")       # 复制项目源码
    .workdir("/app")
    .run_commands("npm install --production")  # 在镜像构建时装好依赖
    .pip_install("httpx", "starlette", "uvicorn")  # Python 代理所需
)


@app.function(
    image=image,
    memory=2048,       # 2GB 内存，Kokoro 峰值约 800MB，余量充足
    cpu=1,
    timeout=300,       # 单次请求最长 5 分钟（TTS 合成可能耗时）
    volumes={"/data/hf-cache": model_cache},  # 持久化模型缓存
)
@modal.asgi_app()
def serve():
    """启动 Express 服务器（子进程），返回 ASGI 代理。"""

    # 设置环境变量
    os.environ["HF_HOME"] = "/data/hf-cache"     # HuggingFace 模型缓存到持久卷
    os.environ["PORT"] = "3000"
    os.environ["NODE_ENV"] = "production"

    # 启动 Node.js Express 服务器
    proc = subprocess.Popen(
        ["node", "/app/server/index.js"],
        cwd="/app",
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )

    # 等待服务器就绪（轮询 health 接口，最多等 60 秒）
    for i in range(60):
        try:
            r = httpx.get("http://127.0.0.1:3000/api/health", timeout=2)
            if r.status_code == 200:
                print(f"[Modal] Express 服务器就绪（{i+1}s）")
                break
        except Exception:
            pass
        time.sleep(1)
    else:
        print("[Modal] ⚠️ Express 服务器启动超时，但仍继续启动代理")

    # ASGI 代理：把所有请求转发到 Express
    async def proxy(request: Request):
        path = request.url.path
        url = f"http://127.0.0.1:3000{path}"
        if request.url.query:
            url += f"?{request.url.query}"

        body = await request.body()
        headers = {
            "Content-Type": request.headers.get("content-type", "application/json"),
        }

        async with httpx.AsyncClient(timeout=120) as client:
            resp = await client.request(
                request.method,
                url,
                content=body if body else None,
                headers=headers,
            )

        # 过滤掉 hop-by-hop 头
        resp_headers = {
            k: v for k, v in resp.headers.items()
            if k.lower() not in ("transfer-encoding", "content-encoding", "content-length")
        }

        return Response(
            content=resp.content,
            status_code=resp.status_code,
            headers=resp_headers,
            media_type=resp.headers.get("content-type", "application/json"),
        )

    routes = [
        Route("/{path:path}", proxy, methods=["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS", "HEAD"]),
    ]
    return Starlette(routes=routes)
