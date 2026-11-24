import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { matchUpdate, newer, verifyRelease } from '../release/policy.mjs';
import { buildDiagnostics } from '../app/diagnostics.mjs';

test('release record binds platform, compatible data format and every downloaded byte', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'desktop-release-'));
  const name = 'Tessmora-0.2.0-mac-arm64.zip';
  await writeFile(join(dir, name), 'fixture archive');
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const secret = join(dir, 'signing.pem');
  const trusted = publicKey.export({ type: 'spki', format: 'pem' });
  await writeFile(secret, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  execFileSync(process.execPath, [fileURLToPath(new URL('../release/sign-manifest.mjs', import.meta.url)), dir, 'darwin-arm64', '0.2.0', '0.2.0', secret]);
  const envelope = JSON.parse(await readFile(join(dir, 'release.json')));
  const signed = verifyRelease(envelope, trusted, 'darwin-arm64');
  const file = signed.files[0];
  const metadata = { version: signed.version, files: [{ url: name, sha512: file.sha512, size: file.size }] };
  assert.equal(matchUpdate(signed, metadata), file);
  assert.throws(() => verifyRelease({ ...envelope, payload: envelope.payload.replace('0.2.0', '0.9.0') }, trusted, 'darwin-arm64'));
  assert.throws(() => verifyRelease(envelope, trusted, 'win32-x64'));
  assert.throws(() => matchUpdate(signed, { ...metadata, files: [{ ...metadata.files[0], url: 'https://other.example/update.zip' }] }));
  assert.throws(() => matchUpdate(signed, { ...metadata, files: [{ ...metadata.files[0], sha512: 'changed' }] }));
  const future = JSON.stringify({ ...signed, workspaceFormat: 2 });
  assert.throws(() => verifyRelease({ payload: future, signature: sign(null, Buffer.from(future), privateKey).toString('base64') }, trusted, 'darwin-arm64'));
  assert(newer('1.10.0', '1.2.1'));
  assert(!newer('0.2.0', '0.2.0'));
  assert(!newer('0.1.0', '0.2.0'));
  assert.throws(() => newer('beta', signed.version));
});
test('diagnostic export contains only allowlisted metadata', async () => {
  const secret = 'sensitive-server.example';
  const data = await buildDiagnostics({ resources: tmpdir(), app: { getVersion: () => '0.1.0' },
    store: { read: async () => ({ workspaces: [{ mode: 'remote', name: secret, url: 'https://' + secret, token: secret }] }) } });
  assert.deepEqual(data.workspaces, [{ mode: 'remote' }]);
  assert(!JSON.stringify(data).includes(secret));
});
