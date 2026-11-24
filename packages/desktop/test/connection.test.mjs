import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { negotiateWorkspace } from '../app/connection.mjs';

async function server(t, handler) {
  const server = createServer(handler); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  return `http://127.0.0.1:${server.address().port}`;
}
test('negotiation verifies auth enforcement, credentials and API compatibility', async t => {
  let version = 1, protectedService = true;
  const url = await server(t, (req, res) => {
    res.setHeader('content-type', 'application/json');
    if (protectedService && req.headers.authorization !== 'Bearer right') { res.writeHead(401).end('{}'); return; }
    if (req.url === '/api/desktop/capabilities') res.end(JSON.stringify({ protocol_version: version, workspace_id: 'server-workspace-a', auth: { required: true }, capabilities: { streaming: true, media_range: true } }));
    else res.end('[]');
  });
  assert.equal((await negotiateWorkspace({ url, token: 'right' })).serverId, 'server-workspace-a');
  await assert.rejects(negotiateWorkspace({ url, token: 'wrong' }), { code: 'AUTH_FAILED' });
  version = 9; await assert.rejects(negotiateWorkspace({ url, token: 'right' }), { code: 'PROTOCOL_INCOMPATIBLE' });
  protectedService = false; await assert.rejects(negotiateWorkspace({ url, token: 'right' }), { code: 'UNPROTECTED_SERVICE' });
});
test('connection redirects never forward credentials to a second server', async t => {
  let leaked = 0;
  const destination = await server(t, (req, res) => { leaked++; res.end('{}'); });
  const url = await server(t, (req, res) => { res.writeHead(302, { location: `${destination}/api/knowledge/` }).end(); });
  await assert.rejects(negotiateWorkspace({ url, token: 'private' }), { code: 'REDIRECT_REJECTED' });
  assert.equal(leaked, 0);
});
