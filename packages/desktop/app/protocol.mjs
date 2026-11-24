import { createReadStream } from 'node:fs';
import { stat, realpath } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { Readable } from 'node:stream';
import { validId } from './workspaces.mjs';

export const SCHEME = 'tessmora';
export const workspaceOrigin = id => {
  if (!validId(id)) throw new Error('Invalid workspace ID');
  return `${SCHEME}://${id}`;
};
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.avif': 'image/avif', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.mp4': 'video/mp4', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.pdf': 'application/pdf', '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8', '.ico': 'image/x-icon' };
const FORWARD_HEADERS = ['accept', 'accept-language', 'content-type', 'range', 'if-range', 'if-none-match', 'if-modified-since', 'last-event-id', 'x-tessmora-language', 'idempotency-key'];
const HOP_HEADERS = ['connection', 'transfer-encoding', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'trailer', 'upgrade', 'set-cookie', 'access-control-allow-origin', 'access-control-allow-credentials'];
export const UI_CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https: http:; media-src 'self' blob: https: http:; font-src 'self' data:; connect-src 'self' https: http:; worker-src 'self' blob:; frame-src 'self' blob:; object-src 'self' blob:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";
const failure = (status, detail) => Response.json({ detail }, { status, headers: { 'Cache-Control': 'no-store' } });
const isApiPath = path => path.startsWith('/api/') || path === '/health';

export function createWorkspaceHandler({ id, baseUrl, token, frontendDir, fetchImpl = fetch, onAuthenticationFailure, offline = false }) {
  const origin = workspaceOrigin(id);
  const backend = new URL(baseUrl);
  if (!['http:', 'https:'].includes(backend.protocol) || backend.username || backend.password || backend.pathname !== '/') throw new Error('Invalid backend origin');
  const root = resolve(frontendDir);
  return async request => {
    try {
      const url = new URL(request.url);
      if (url.protocol !== `${SCHEME}:` || url.host !== id || url.username || url.password) return failure(403, '工作区来源不匹配。');
      if (request.headers.get('origin') && request.headers.get('origin') !== origin) return failure(403, '跨工作区请求已拒绝。');
      if (!['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'].includes(request.method)) return failure(405, '不支持此请求方法。');
      if (isApiPath(url.pathname)) {
        if (offline) return failure(503, '此窗口仅用于导出客户端历史。');
        const headers = new Headers();
        for (const name of FORWARD_HEADERS) if (request.headers.has(name)) headers.set(name, request.headers.get(name));
        headers.set('accept-encoding', 'identity');
        headers.set('authorization', `Bearer ${token}`);
        headers.set('x-tessmora-setup-token', token);
        const controller = new AbortController();
        const abort = () => controller.abort();
        request.signal.addEventListener('abort', abort, { once: true });
        if (request.signal.aborted) controller.abort();
        const timeout = setTimeout(() => controller.abort(), ['GET', 'HEAD'].includes(request.method) ? 30000 : 30 * 60 * 1000);
        let upstream;
        try {
          upstream = await fetchImpl(`${backend.origin}${url.pathname}${url.search}`, {
            method: request.method, headers, redirect: 'manual', signal: controller.signal,
            ...(!['GET', 'HEAD'].includes(request.method) && request.body ? { body: request.body, duplex: 'half' } : {}),
          });
        } finally { clearTimeout(timeout); }
        if ([401, 403].includes(upstream.status)) onAuthenticationFailure?.();
        const responseHeaders = new Headers(upstream.headers);
        for (const header of HOP_HEADERS) responseHeaders.delete(header);
        // Node fetch decodes content codings. Never expose the compressed length as decoded length.
        if (responseHeaders.has('content-encoding')) { responseHeaders.delete('content-encoding'); responseHeaders.delete('content-length'); }
        if (upstream.status >= 300 && upstream.status < 400 && responseHeaders.has('location')) {
          const target = new URL(responseHeaders.get('location'), backend);
          await upstream.body?.cancel();
          request.signal.removeEventListener('abort', abort);
          if (target.origin !== backend.origin || !isApiPath(target.pathname) || target.username || target.password) return failure(502, '服务重定向到未授权地址，已停止请求。');
          responseHeaders.set('location', `${origin}${target.pathname}${target.search}${target.hash}`);
          return new Response(null, { status: upstream.status, headers: responseHeaders });
        }
        responseHeaders.set('x-content-type-options', 'nosniff');
        // API-served documents are untrusted content, never a privileged application page.
        responseHeaders.set('content-security-policy', "sandbox; default-src 'none'; style-src 'unsafe-inline'");
        const noBody = ['HEAD'].includes(request.method) || [204, 205, 304].includes(upstream.status);
        if (noBody || !upstream.body) {
          request.signal.removeEventListener('abort', abort);
          return new Response(null, { status: upstream.status, headers: responseHeaders });
        }
        const reader = upstream.body.getReader();
        const body = new ReadableStream({
          async pull(stream) {
            try {
              const { value, done } = await reader.read();
              if (done) { request.signal.removeEventListener('abort', abort); stream.close(); }
              else stream.enqueue(value);
            } catch (error) { request.signal.removeEventListener('abort', abort); stream.error(error); }
          },
          async cancel() { controller.abort(); request.signal.removeEventListener('abort', abort); await reader.cancel().catch(() => {}); },
        });
        return new Response(body, { status: upstream.status, headers: responseHeaders });
      }
      if (!['GET', 'HEAD'].includes(request.method)) return failure(405, '静态页面仅支持读取。');
      let decoded;
      try { decoded = decodeURIComponent(url.pathname); } catch { return failure(400, '地址无效。'); }
      if (decoded.includes('\0') || decoded.includes('\\') || decoded.split('/').includes('..')) return failure(403, '文件路径已拒绝。');
      let file = resolve(root, `.${decoded}`);
      if (file !== root && !file.startsWith(root + sep)) return failure(403, '文件路径已拒绝。');
      let info = await stat(file).catch(() => null);
      if (!info?.isFile()) {
        // Only SPA routes receive index.html. Missing assets remain genuine 404s.
        if (extname(decoded) || /^\/(?:assets|vendor-logos|architecture|knowledge)\//.test(decoded)) return failure(404, '文件不存在。');
        file = resolve(root, 'index.html');
        info = await stat(file).catch(() => null);
      }
      if (!info?.isFile()) return failure(503, '桌面前端资源未安装。请重新安装应用。');
      const realRoot = await realpath(root);
      const realFile = await realpath(file);
      if (!realFile.startsWith(realRoot + sep)) return failure(403, '文件路径已拒绝。');
      const headers = { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'Content-Length': String(info.size),
        'Content-Security-Policy': UI_CSP, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': extname(file) === '.html' ? 'no-store' : 'private, max-age=3600' };
      return new Response(request.method === 'HEAD' ? null : Readable.toWeb(createReadStream(realFile)), { headers });
    } catch (error) {
      if (request.signal.aborted) return failure(499, '请求已取消。');
      return failure(502, '工作区连接中断。后台任务可在恢复连接后继续查看。');
    }
  };
}
