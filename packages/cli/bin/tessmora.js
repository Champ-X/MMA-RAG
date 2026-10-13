#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { locations } from '../src/config.js';
import { execute } from '../src/commands.js';
import { createUI } from '../src/ui.js';
import { brandBanner } from '../src/brand.js';
import { publicError, TessmoraError } from '../src/errors.js';
import { commandFormatter } from '../src/invocation.js';

const HELP = `  用法  tessmora [命令] [选项]

  setup       终端首次配置向导，可从中断位置继续
  configure   修改能力、模型凭证和运行设置
  start       启动并打开网页
  stop        停止本实例，保留全部数据
  status      查看服务与模型准备状态
  logs        查看本实例日志
  doctor      检查环境、容器和真实服务状态
  open        在浏览器打开已运行实例（建立本机配置会话）

  --instance <名称>         独立实例名，默认 default
  --home <目录>             CLI 配置目录，默认 ~/.tessmora
  --source <源码目录>        从源码构建此开发版 Docker 镜像
  --mode local|remote       运行方式
  --url <服务地址>           远程连接地址
  --capabilities <列表>      text,image,audio,video，默认 text
  --data-dir <目录>          首次安装的数据目录
  --port <端口>              网页端口，默认 3001
  --storage-port <端口>      文件存储端口，默认 9000
  --backend-image <镜像>     已发布后端镜像引用
  --frontend-image <镜像>    已发布前端镜像引用
  --minio-image <镜像>       可信 MinIO 镜像；默认从固定官方源码构建
  --model-endpoint <URL>     本地模型下载地址，默认 https://huggingface.co
  --build-proxy <URL>        构建容器可访问的 HTTP(S) 代理
  --proxy <URL|off>          模型调用与下载的运行代理，默认关闭
  --debian-mirror <URL>      Debian 系统依赖下载地址
  --credential-file <文件>   非交互配置的私有 JSON 凭证文件
  --yes                     非交互模式使用指定参数和推荐默认值
  --no-open                 不打开浏览器
  --print-url               配合 open 显示私有连接链接，不打开浏览器
  --json                    stdout 输出 JSON，进度写入 stderr
  --rebuild                 重新构建本地源码镜像
  --tail <行数>             logs 行数，默认 100
  --service <服务>          logs 服务过滤
  --follow                  持续查看日志
  --help                    显示帮助
  --version                 显示版本

  无配置时直接运行 tessmora 即开始引导；已有配置时启动服务。
  发布前开发版：在源码根目录运行 tessmora setup --source .
  注册终端命令：在源码根目录运行 npm --prefix packages/cli run register-command
`;

let json = process.argv.includes('--json');
let format = commandFormatter();
try {
  const { values: options, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      help: { type: 'boolean', short: 'h' }, version: { type: 'boolean', short: 'v' }, json: { type: 'boolean' }, yes: { type: 'boolean', short: 'y' },
      'no-open': { type: 'boolean' }, 'print-url': { type: 'boolean' }, rebuild: { type: 'boolean' }, follow: { type: 'boolean', short: 'f' },
      ...Object.fromEntries(['instance', 'home', 'source', 'mode', 'url', 'capabilities', 'data-dir', 'port', 'storage-port', 'backend-image', 'frontend-image', 'minio-image', 'model-endpoint', 'build-proxy', 'proxy', 'debian-mirror', 'credential-file', 'tail', 'service'].map((key) => [key, { type: 'string' }])),
    },
  });
  json = Boolean(options.json);
  format = commandFormatter(options);
  if (options.help) process.stdout.write(brandBanner() + format(HELP));
  else if (options.version) process.stdout.write(json ? '{"version":"0.1.0"}\n' : '0.1.0\n');
  else {
    if (positionals.length > 1) throw new TessmoraError('INVALID_ARGUMENTS', '每次只能运行一个命令。', '运行 tessmora --help 查看用法。');
    const command = positionals[0];
    if (options['print-url'] && (command !== 'open' || json)) throw new TessmoraError('INVALID_ARGUMENTS', '--print-url 仅用于 open，且不能与 --json 一起使用。', '运行 tessmora open --print-url，仅向当前终端显示私有连接链接。');
    if (command && !['setup', 'configure', 'start', 'stop', 'status', 'logs', 'doctor', 'open'].includes(command)) throw new TessmoraError('UNKNOWN_COMMAND', `未知命令 ${command}。`, '运行 tessmora --help 查看用法。');
    const ui = createUI(options);
    const result = await execute(command, locations(options), options, ui);
    if (json) ui.result(result);
    if (result?.success === false) process.exitCode = 1;
  }
} catch (error) {
  const result = publicError(error);
  result.message = format(result.message);
  if (result.hint) result.hint = format(result.hint);
  if (json) process.stdout.write(JSON.stringify({ success: false, error: result }) + '\n');
  else process.stderr.write(`\n${result.code === 'CANCELLED' ? '◇' : '✕'} ${result.message}${result.hint ? `\n  ${result.hint}` : ''}\n`);
  process.exitCode = error.code === 'CANCELLED' ? 130 : 1;
}
