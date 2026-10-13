import { createHash } from 'node:crypto';
import { lstat, readdir, readFile, readlink } from 'node:fs/promises';
import { join, posix } from 'node:path';
import { TessmoraError } from './errors.js';

// Keep aligned with .dockerignore and deploy/Dockerfile.{backend,frontend}.
// Hash actual build inputs, including uncommitted edits and source archives.
// Credentials, knowledge, weights, dependencies and generated output are excluded.
const inputs = [
  '.dockerignore', 'deploy', 'backend/requirements.txt', 'backend/celery_app.py', 'backend/app',
  'agent-runtime/package.json', 'agent-runtime/package-lock.json', 'agent-runtime/src',
  'frontend/package.json', 'frontend/package-lock.json', 'frontend/index.html',
  'frontend/vite.config.ts', 'frontend/tailwind.config.js', 'frontend/postcss.config.js',
  'frontend/src', 'frontend/public',
];
const excluded = name => ['__pycache__', 'node_modules', '.DS_Store'].includes(name)
  || name === '.env' || name.startsWith('.env.') || name.endsWith('.pyc');

export async function sourceFingerprint(source) {
  const hash = createHash('sha256').update('tessmora-source-build-v1\0');
  const visit = async relative => {
    const path = join(source, relative);
    const info = await lstat(path);
    hash.update(`${relative}\0${info.mode & 0o111}\0`);
    if (info.isDirectory()) {
      hash.update('directory\0');
      for (const name of (await readdir(path)).filter(name => !excluded(name)).sort()) {
        await visit(posix.join(relative, name));
      }
    } else if (info.isSymbolicLink()) {
      // Docker copies symlinks; never follow them into private files.
      hash.update(`link\0${await readlink(path)}\0`);
    } else if (info.isFile()) {
      hash.update(`file\0${info.size}\0`).update(await readFile(path)).update('\0');
    } else throw new Error('Unsupported build input');
  };
  try {
    const configs = (await readdir(join(source, 'frontend')))
      .filter(name => /^tsconfig.*\.json$/.test(name)).map(name => `frontend/${name}`);
    for (const relative of [...inputs, ...configs].sort()) await visit(relative);
    return hash.digest('hex');
  } catch {
    throw new TessmoraError('SOURCE_UNREADABLE', '无法检查应用源码，未复用旧镜像。',
      '确认原源码目录完整且可读取；在该目录更新代码后重新运行 tessmora setup。');
  }
}
