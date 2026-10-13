import test from 'node:test';
import assert from 'node:assert/strict';
import { openWorkspace } from '../src/browser-entry.js';

function fixture() {
  const notices = [], links = [], opened = [];
  return { notices, links, opened, state: { mode: 'local', url: 'http://localhost:3001' },
    ui: { warn: value => notices.push(value), connectionLink: value => links.push(value) },
    deps: { ensureEnvironment: async () => ({ TESSMORA_SETUP_TOKEN: 'private-test-token' }),
      openBrowser: async url => { opened.push(url); return false; } } };
}
test('browser handoff failure explains a usable authenticated fallback without disclosing secrets', async () => {
  const f = fixture();
  assert.equal(await openWorkspace({}, f.state, f.ui, {}, f.deps), false);
  assert.equal(new URL(f.opened[0]).hash, '#setup_token=private-test-token');
  assert.match(f.notices.join(''), /tessmora open --print-url/);
  assert.ok(!f.notices.join('').includes('private-test-token'));
  assert.deepEqual(f.links, []);
});
test('explicit print-url hands off one complete link and does not launch a browser', async () => {
  const f = fixture();
  assert.equal(await openWorkspace({}, f.state, f.ui, { printUrl: true }, f.deps), true);
  assert.deepEqual(f.links, ['http://localhost:3001/#setup_token=private-test-token']);
  assert.deepEqual(f.opened, []);
  assert.ok(!f.notices.join('').includes('private-test-token'));
});
test('remote connection never loads local credentials', async () => {
  const f = fixture();
  await openWorkspace({}, { mode: 'remote', url: 'https://example.test' }, f.ui, { printUrl: true },
    { ...f.deps, ensureEnvironment: () => assert.fail('remote must not load secrets') });
  assert.deepEqual(f.links, ['https://example.test/']);
});
