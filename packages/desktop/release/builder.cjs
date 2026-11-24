const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const repo = path.resolve(root, '../..');
const runtime = path.resolve(process.env.TESSMORA_RUNTIME_DIR || path.join(repo, 'ops/desktop-qa/runtime'));
const production = process.env.TESSMORA_SIGNED_RELEASE === '1';
const manifest = JSON.parse(fs.readFileSync(path.join(runtime, 'runtime.json')));
if (manifest.platform !== process.platform + '-' + process.arch) throw new Error('Build the runtime on its native platform first.');
const output = path.resolve(process.env.TESSMORA_DESKTOP_OUTPUT || path.join(repo, 'ops/desktop-qa/installers'));
const trust = process.env.TESSMORA_UPDATE_TRUST_FILE;
let feed;
if (production) {
  if (!trust) throw new Error('Provide the baked-in feed address and Ed25519 public key.');
  const policy = JSON.parse(fs.readFileSync(trust));
  feed = new URL(policy.feed);
  if (feed.protocol !== 'https:' || feed.username || feed.password || feed.search || feed.hash || !feed.pathname.endsWith('/') ||
      require('node:crypto').createPublicKey(policy.publicKey).asymmetricKeyType !== 'ed25519') throw new Error('Invalid release trust file.');
  if (process.platform === 'win32' && !process.env.TESSMORA_WINDOWS_PUBLISHER) throw new Error('Missing Authenticode publisher.');
}
module.exports = {
  appId: 'com.tessmora.desktop', productName: 'Tessmora', asar: true, npmRebuild: false,
  directories: { output }, files: ['app/**/*', 'runtime/manager.mjs', 'release/policy.mjs', 'package.json'],
  extraResources: [{ from: path.join(repo, 'frontend/dist'), to: 'frontend' }, { from: runtime, to: 'runtime' },
    ...(production ? [{ from: path.resolve(trust), to: 'release-trust.json' }] : [])],
  artifactName: 'Tessmora-${version}-${os}-${arch}.${ext}',
  electronFuses: { runAsNode: false, enableNodeOptionsEnvironmentVariable: false, enableNodeCliInspectArguments: false,
    enableEmbeddedAsarIntegrityValidation: true, onlyLoadAppFromAsar: true },
  // Only an explicit signed build has an update origin. Building never publishes.
  publish: production ? [{ provider: 'generic', url: feed.href }] : null,
  forceCodeSigning: production,
  mac: { icon: path.join(repo, 'frontend/public/tessmora-logo.png'), target: ['dmg', 'zip'], category: 'public.app-category.productivity',
    ...(production ? { hardenedRuntime: true, notarize: true } : { identity: "-", hardenedRuntime: false }) },
  win: { icon: path.join(repo, 'frontend/public/tessmora-logo.png'), target: ['nsis'], verifyUpdateCodeSignature: true,
    ...(production ? { signtoolOptions: { publisherName: process.env.TESSMORA_WINDOWS_PUBLISHER } } : {}) },
  nsis: { oneClick: false, perMachine: false, allowToChangeInstallationDirectory: true, deleteAppDataOnUninstall: false },
};
