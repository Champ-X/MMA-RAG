import { copyFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const assets = new URL('../assets/', import.meta.url);
await mkdir(assets, { recursive: true });
await copyFile(new URL('../../../deploy/compose.yaml', import.meta.url), new URL('compose.yaml', assets));
console.error(`Bundled runtime manifest: ${fileURLToPath(assets)}compose.yaml`);
