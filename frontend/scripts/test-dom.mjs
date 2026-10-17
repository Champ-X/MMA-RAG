import { build } from 'esbuild';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

// Each replay installs its own DOM globals, so run it in a separate process.
const root = fileURLToPath(new URL('../', import.meta.url));
const temporary = await mkdtemp(join(tmpdir(), 'tessmora-dom-'));
try {
  const tests = (await readdir(join(root, 'tests'))).filter(name => name.endsWith('.dom.tsx')).sort();
  if (!tests.length) throw new Error('No DOM regression tests found');
  for (const name of tests) {
    const outfile = join(temporary, name.replace(/\.tsx$/, '.cjs'));
    await build({ absWorkingDir: root, entryPoints: [join('tests', name)], outfile,
      bundle: true, platform: 'node', format: 'cjs', loader: { '.css': 'empty' },
      external: ['react', 'react/*', 'react-dom', 'react-dom/*', 'jsdom'],
      logOverride: { 'empty-import-meta': 'silent' },
    });
    const code = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ['--test', outfile], { cwd: root, stdio: 'inherit',
        env: { ...process.env, NODE_PATH: [join(root, 'node_modules'), process.env.NODE_PATH].filter(Boolean).join(delimiter) },
      });
      child.once('error', reject);
      child.once('exit', (status, signal) => signal ? reject(new Error(`${name} exited with ${signal}`)) : resolve(status));
    });
    if (code !== 0) { process.exitCode = code || 1; break; }
  }
} finally {
  await rm(temporary, { recursive: true, force: true });
}
