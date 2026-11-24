// Usage: node release/sign-manifest.mjs <artifact-dir> <platform> <app-version> <runtime-version> <private-key-file>
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createPrivateKey, createPublicKey, sign } from 'node:crypto';
import { fileDigest, verifyRelease } from './policy.mjs';
const [directory, platform, version, runtimeVersion, keyPath] = process.argv.slice(2);
if (!keyPath || !['darwin-arm64', 'win32-x64'].includes(platform)) throw new Error('Expected artifact directory, platform, versions and Ed25519 private key path.');
const key = createPrivateKey(await readFile(keyPath));
if (key.asymmetricKeyType !== 'ed25519') throw new Error('Use an Ed25519 release key.');
const suffix = platform === 'darwin-arm64' ? /\.(zip|dmg)$/ : /\.exe$/;
const files = [];
for (const name of (await readdir(directory)).filter(f => suffix.test(f)).sort()) {
  files.push({ name, ...await fileDigest(join(directory, name)) });
}
const payload = JSON.stringify({ format: 1, platform, version, runtimeVersion, apiProtocol: 1, workspaceFormat: 1, files });
const envelope = { payload, signature: sign(null, Buffer.from(payload), key).toString('base64') };
verifyRelease(envelope, createPublicKey(key).export({ type: 'spki', format: 'pem' }), platform);
await writeFile(join(directory, 'release.json'), JSON.stringify(envelope) + '\n', { flag: 'wx' });
