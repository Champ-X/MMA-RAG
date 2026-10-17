// A slow but active stream may finish. A stalled connection must not keep a
// deleted/failed task alive indefinitely. This is not a whole-run deadline.
export async function fetchWithIdleTimeout(transport, url, init, signal, idleMs = 120000) {
  const idle = new AbortController();
  const combined = AbortSignal.any([idle.signal, ...(signal ? [signal] : [])]);
  let timer;
  const reset = () => {
    clearTimeout(timer);
    if (!combined.aborted) {
      timer = setTimeout(() => idle.abort(new DOMException('模型连接长时间没有返回数据', 'TimeoutError')), idleMs);
      timer.unref?.();
    }
  };
  const cleanup = () => { clearTimeout(timer); combined.removeEventListener('abort', cleanup); };
  combined.addEventListener('abort', cleanup, { once: true });
  reset();
  try {
    const response = await transport(url, { ...init, signal: combined });
    if (!response.body) { cleanup(); return response; }
    const reader = response.body.getReader();
    const body = new ReadableStream({
      async pull(controller) {
        try {
          const { value, done } = await reader.read();
          if (done) { cleanup(); reader.releaseLock(); controller.close(); }
          else { reset(); controller.enqueue(value); }
        } catch (error) { cleanup(); reader.releaseLock(); controller.error(error); }
      },
      async cancel(reason) { cleanup(); await reader.cancel(reason); reader.releaseLock(); },
    });
    return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
  } catch (error) { cleanup(); throw error; }
}
