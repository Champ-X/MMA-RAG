import { createHash, createPublicKey, verify } from 'node:crypto';
import { createReadStream } from 'node:fs';

const stableVersion = /^\d{1,6}\.\d{1,6}\.\d{1,6}$/;
const fileName = /^[\w][\w.-]{0,170}\.(?:exe|zip|dmg)$/;
export function newer(version, installed) {
  if (![version, installed].every(v => typeof v === 'string' && stableVersion.test(v))) throw new Error('发行版本格式无效。');
  const before = installed.split('.').map(Number);
  const diff = version.split('.').map((v, i) => Number(v) - before[i]).find(n => n !== 0);
  return (diff || 0) > 0;
}
export function verifyRelease(envelope, publicKey, target) {
  const key = createPublicKey(publicKey);
  if (key.asymmetricKeyType !== 'ed25519' || typeof envelope?.payload !== 'string' || envelope.payload.length > 50000 ||
      !verify(null, Buffer.from(envelope.payload), key, Buffer.from(envelope.signature || '', 'base64'))) throw new Error('更新清单的签名无效。');
  const data = JSON.parse(envelope.payload);
  if (data.format !== 1 || data.platform !== target || data.workspaceFormat !== 1 || data.apiProtocol !== 1 ||
      !stableVersion.test(data.version) || !stableVersion.test(data.runtimeVersion) || !Array.isArray(data.files) || !data.files.length ||
      !data.files.every(f => fileName.test(f.name) && /^[a-zA-Z0-9+/]{86}==$/.test(f.sha512) && Number.isSafeInteger(f.size) && f.size > 0) ||
      new Set(data.files.map(f => f.name)).size !== data.files.length) throw new Error('更新包、平台或数据格式不兼容。');
  return data;
}
export function matchUpdate(signed, metadata) {
  if (metadata?.version !== signed.version || !metadata.files?.length || metadata.packages || !metadata.files.every(f =>
    !f.packageInfo && signed.files.some(s => f.url === s.name && f.sha512 === s.sha512 && f.size === s.size))) {
    throw new Error('下载清单与签名发行记录不一致。');
  }
  const suffix = signed.platform === 'win32-x64' ? '.exe' : '.zip';
  const files = metadata.files.filter(f => f.url.endsWith(suffix));
  if (files.length !== 1) throw new Error('未找到唯一匹配的安装包。');
  return signed.files.find(s => s.name === files[0].url);
}
export async function fileDigest(path) {
  let size = 0;
  const hash = createHash('sha512');
  for await (const chunk of createReadStream(path)) { hash.update(chunk); size += chunk.length; }
  return { size, sha512: hash.digest('base64') };
}
