import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { sourceFingerprint } from '../src/source-build.js';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'tessmora-source-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const put = async (path, text = 'fixture') => {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), text);
  };
  for (const path of ['.dockerignore', 'deploy/Dockerfile.backend', 'deploy/Dockerfile.frontend',
    'backend/requirements.txt', 'backend/celery_app.py', 'backend/app/main.py',
    'agent-runtime/package.json', 'agent-runtime/package-lock.json', 'agent-runtime/src/main.js',
    'frontend/package.json', 'frontend/package-lock.json', 'frontend/index.html', 'frontend/tsconfig.json',
    'frontend/vite.config.ts', 'frontend/tailwind.config.js', 'frontend/postcss.config.js',
    'frontend/src/App.tsx', 'frontend/public/favicon.svg']) await put(path);
  return { root, put };
}

test('fingerprints cover source archives, uncommitted edits, additions, deletions and build recipes', async t => {
  const { root, put } = await fixture(t);
  let previous = await sourceFingerprint(root);
  assert.equal(await sourceFingerprint(root), previous);
  for (const path of ['backend/app/main.py', 'agent-runtime/src/main.js', 'frontend/src/App.tsx',
    'frontend/tsconfig.extra.json', 'deploy/Dockerfile.backend', '.dockerignore']) {
    await put(path, 'new content');
    const current = await sourceFingerprint(root);
    assert.notEqual(current, previous, path);
    previous = current;
  }
  await rm(join(root, 'frontend/tsconfig.extra.json'));
  assert.notEqual(await sourceFingerprint(root), previous);
});

test('private configuration, knowledge, dependencies and generated output do not trigger rebuilds', async t => {
  const { root, put } = await fixture(t);
  const original = await sourceFingerprint(root);
  for (const path of ['backend/.env', 'backend/data/knowledge.json', 'frontend/.env.local',
    'frontend/dist/app.js', 'frontend/node_modules/pkg/index.js', 'backend/app/__pycache__/main.pyc',
    'backend/app/.env', 'README.md', 'docs/report.md']) await put(path, 'private synthetic fixture');
  assert.equal(await sourceFingerprint(root), original);
});

test('symlink targets are not read and an incomplete source cannot silently use a stale image', async t => {
  const { root, put } = await fixture(t);
  await put('private.txt', 'private-one');
  await symlink(join(root, 'private.txt'), join(root, 'frontend/public/link'));
  const original = await sourceFingerprint(root);
  await put('private.txt', 'private-two');
  assert.equal(await sourceFingerprint(root), original);
  await rm(join(root, 'backend/requirements.txt'));
  await assert.rejects(sourceFingerprint(root), { code: 'SOURCE_UNREADABLE' });
});
