// The existing web deployment owns its data, authentication and lifetime.
export const localWebOrigin = 'http://localhost:3001';

async function readBounded(response, limit) {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks = [];
  let bytes = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return Buffer.concat(chunks).toString('utf8');
      bytes += value.byteLength;
      if (bytes > limit) {
        await reader.cancel();
        return '';
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
}

export async function detectLocalWeb(fetchImpl = fetch) {
  const signal = AbortSignal.timeout(4500);
  async function get(path, type, limit) {
    const response = await fetchImpl(localWebOrigin + path, { signal, redirect: 'manual', credentials: 'omit', headers: { Accept: type } });
    if (!response.ok || !response.headers.get('content-type')?.toLowerCase().includes(type)) {
      await response.body?.cancel();
      return { status: response.status, text: '' };
    }
    return { status: response.status, text: await readBounded(response, limit) };
  }
  try {
    const home = await get('/', 'text/html', 64 * 1024);
    if ([401, 403].includes(home.status)) return 'protected';
    if (!/<title\b[^>]*>\s*Tessmora\b/i.test(home.text)) return 'unrecognized';
    const setup = await get('/api/setup/status', 'application/json', 1024 * 1024);
    if ([401, 403].includes(setup.status)) return 'protected';
    if (!setup.text) return 'unavailable';
    const status = JSON.parse(setup.text);
    return typeof status?.setup_required === 'boolean' && typeof status?.ready === 'boolean' ? 'online' : 'unrecognized';
  } catch { return 'unavailable'; }
}
