import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { delimiter, join, resolve } from 'node:path';
import './prepare-assets.js';

const directory = fileURLToPath(new URL('..', import.meta.url));
const env = { ...process.env };
// `npm --prefix packages/cli run ...` forwards the *source directory* as the
// global prefix to child npm commands. Do not install a self-link into it.
if (env.npm_config_prefix && resolve(env.npm_config_prefix) === resolve(directory)) delete env.npm_config_prefix;
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const result = spawnSync(npm, ['link', '--ignore-scripts'], { cwd: directory, env, stdio: 'inherit' });
if (result.error || result.status !== 0) {
  console.error('命令注册未完成。确认 npm 全局安装目录可写；仍可使用 node packages/cli/bin/tessmora.js。');
  process.exitCode = 1;
} else {
  const prefix = spawnSync(npm, ['prefix', '--global'], { cwd: directory, env, encoding: 'utf8' });
  const bin = process.platform === 'win32' ? prefix.stdout?.trim() : join(prefix.stdout?.trim() || '', 'bin');
  console.error(`已注册 tessmora 命令${bin ? `：${bin}` : ''}。`);
  if (bin && !env.PATH?.split(delimiter).some(path => resolve(path) === resolve(bin))) {
    console.error('该目录尚未加入 PATH。请加入后重开终端；macOS / Linux / WSL 当前终端可执行：\nexport PATH="$(npm prefix -g)/bin:$PATH"');
  }
  console.error('验证：tessmora --version；启动：tessmora setup；停止：tessmora stop。');
}
