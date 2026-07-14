"""
线上情景英语 — Modal.com 部署入口

部署命令：
    pip3 install modal httpx starlette uvicorn
    python3 -m modal token new
    python3 -m modal deploy modal_app.py
"""

import modal
import subprocess
import os
import time
from starlette.applications import Starlette
from starlette.routing import Route
from starlette.responses import Response
from starlette.requests import Request

app = modal.App("online-situational-english")

# 持久化卷：缓存 Kokoro 模型
model_cache = modal.Volume.from_name("kokoro-model-cache", create_if_missing=True)

# 镜像：Node.js + Python 依赖 + 本地源码（copy=True 烤进镜像层，才能 npm install）
image = (
    modal.Image.from_registry("node:22-slim")
    .apt_install("libgomp1", "python3", "python3-pip", "python3-venv")
    .run_commands(
        "python3 -m venv /opt/venv",
        "/opt/venv/bin/pip install httpx starlette uvicorn",
    )
    .env({"PATH": "/opt/venv/bin:$PATH"})
    .add_local_dir(".", "/app", copy=True, ignore=["node_modules", ".git", "dist", "*.log"])
    .run_commands("cd /app && npm install --production")
)


@app.function(
    image=image,
    memory=2048,
    cpu=1,
    timeout=300,
    volumes={"/data/hf-cache": model_cache},
)
@modal.asgi_app()
def serve():
    """启动 Express 服务器（子进程），返回 ASGI 代理。"""

    os.environ["HF_HOME"] = "/data/hf-cache"
    os.environ["PORT"] = "3000"
    os.environ["NODE_ENV"] = "production"

    # 启动 Node.js Express 服务器
    proc = subprocess.Popen(
        ["node", "/app/server/index.js"],
        cwd="/app",
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )

    # 等待服务器就绪
    import httpx
    for i in range(90):
        try:
            r = httpx.get("http://127.0.0.1:3000/api/health", timeout=2)
            if r.status_code == 200:
                print(f"[Modal] Express ready ({i+1}s)")
                break
        except Exception:
            pass
        time.sleep(1)
    else:
        print("[Modal] WARNING: Express startup timeout, proxy will attempt anyway")

    # ASGI 代理
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
