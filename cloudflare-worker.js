/**
 * HuggingFace 国内镜像 CORS 代理
 * 
 * 部署步骤：
 * 1. 打开 https://dash.cloudflare.com → 注册/登录（不用绑卡）
 * 2. 左侧菜单 → Workers & Pages → Create → Create Worker
 * 3. 名字随便填（如 hf-proxy）→ 把下面代码粘贴进去 → Deploy
 * 4. 部署后拿到网址（如 https://hf-proxy.xxx.workers.dev）
 * 5. 把网址发给我，我更新前端代码
 */

export default {
  async fetch(request) {
    // 处理 CORS 预检请求
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
          'Access-Control-Allow-Headers': '*',
          'Access-Control-Max-Age': '86400',
        },
      });
    }

    const url = new URL(request.url);
    
    // 健康检查
    if (url.pathname === '/' || url.pathname === '/health') {
      return new Response('OK', { headers: { 'Access-Control-Allow-Origin': '*' } });
    }

    // 转发到 hf-mirror.com
    const targetUrl = 'https://hf-mirror.com' + url.pathname + url.search;
    
    try {
      const response = await fetch(targetUrl, {
        method: request.method,
        headers: request.headers,
        redirect: 'follow',
      });

      // 加上 CORS 头
      const newHeaders = new Headers(response.headers);
      newHeaders.set('Access-Control-Allow-Origin', '*');
      newHeaders.set('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
      newHeaders.set('Access-Control-Allow-Headers', '*');

      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: newHeaders,
      });
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), {
        status: 502,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }
  },
};
