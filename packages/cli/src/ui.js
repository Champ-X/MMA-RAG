import * as p from '@clack/prompts';
import pc from 'picocolors';
import { TessmoraError } from './errors.js';
import { brandBanner } from './brand.js';
import { fitLine } from './terminal.js';
import { commandFormatter } from './invocation.js';

p.updateSettings({ messages: { cancel: '已暂停，可稍后继续', error: '此步骤尚未完成' } });

export const BACK = '__back';
export const labels = { text: '文档问答', image: '图片理解与检索', audio: '音频理解与检索', video: '视频理解与检索' };
export const providerLabels = { deepseek: 'DeepSeek', siliconflow: 'SiliconFlow', aliyun_bailian: '阿里云百炼', openrouter: 'OpenRouter' };

export function createUI({ json = false, quiet = false, interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY), ...options } = {}) {
  const tty = interactive && !json;
  const format = commandFormatter(options);
  const check = (value) => {
    if (p.isCancel(value)) throw new TessmoraError('CANCELLED', '已保存进度，随时运行 tessmora setup 继续。');
    return value;
  };
  return {
    interactive: tty,
    // Only the explicit `open --print-url` action may disclose this link.
    // Keep it out of structured events, setup journals and diagnostics.
    connectionLink(url) { process.stdout.write(`${url}\n`); },
    intro() {
      if (tty) {
        process.stdout.write(brandBanner());
        p.intro(`${pc.cyan(pc.bold('Tessmora'))}  ${pc.dim('/')}  安装与配置`);
        p.log.message(`${pc.cyan('碎片 → 知识 → 答案')}\n${pc.dim('逐步准备你的知识工作台 · 随时可以暂停')}\n\n${pc.dim('↑↓ 选择   空格勾选   回车继续   Ctrl+C 保存退出')}`);
      }
    },
    step(number, title, description) {
      if (tty) p.log.step(`${pc.cyan('▰ '.repeat(number))}${pc.dim('▱ '.repeat(6 - number))} ${pc.dim(`${number} / 6`)}\n${pc.bold(title)}${description ? `\n${pc.dim(description)}` : ''}`);
      else if (!quiet) process.stderr.write(`${json ? JSON.stringify({ event: 'step', number, title }) : `[${number}/6] ${title}`}\n`);
    },
    info(message) { message = format(message); if (tty) p.log.info(message); else if (!quiet) process.stderr.write(`${json ? JSON.stringify({ event: 'info', message }) : message}\n`); },
    warn(message) { message = format(message); if (tty) p.log.warn(message); else process.stderr.write(`${json ? JSON.stringify({ event: 'warning', message }) : message}\n`); },
    success(message) { message = format(message); if (tty) p.log.success(message); else if (!quiet) process.stderr.write(`${json ? JSON.stringify({ event: 'success', message }) : message}\n`); },
    async select(message, options, initialValue) { return check(await p.select({ message, options: options.map(option => ({ ...option, ...(option.hint ? { hint: fitLine(option.hint, Math.max(16, (process.stdout.columns || 80) - 35)) } : {}) })), initialValue, showInstructions: false })); },
    async multiselect(message, options, initialValues) { return check(await p.multiselect({ message, options, initialValues, required: true, showInstructions: false })); },
    async text(message, initialValue = '', validate) { return check(await p.text({ message, initialValue, validate })); },
    async password(message) { return check(await p.password({ message, mask: '•' })); },
    async confirm(message, initialValue = true) { return check(await p.confirm({ message, initialValue })); },
    spinner(message) {
      if (!tty) {
        this.info(message);
        let lastUpdate = 0;
        let lastMessage = message;
        return {
          message: (text) => {
            if (text !== lastMessage && Date.now() - lastUpdate >= 5000) { this.info(text); lastUpdate = Date.now(); lastMessage = text; }
          },
          stop: (text) => this.success(text),
          error: (text) => this.warn(text),
        };
      }
      const spinner = p.spinner({
        indicator: 'timer',
        styleFrame: (frame) => pc.cyan(frame),
        onCancel: () => { process.stderr.write(format('\n进度与下载缓存已保留。运行 tessmora setup 继续。\n')); process.exit(130); },
      });
      // Clack clears using the message width, but renders an extra frame/timer.
      // Reserve those cells to prevent wrapped animation frames leaving stale rows.
      const initialColumns = process.stdout.columns || 80;
      const compact = (text) => fitLine(text, Math.max(8, Math.min(initialColumns, process.stdout.columns || 80) - 22));
      spinner.start(compact(message));
      // Clack's input blocker exits 0 on raw Ctrl+C before emitting SIGINT.
      // Intercept it first so cancellation has the same exit contract as prompts.
      const cancelKey = (_value, key = {}) => {
        if (key.sequence === '\u0003' || key.name === 'escape') {
          spinner.cancel('已保留进度');
          process.stderr.write(format('继续配置：tessmora setup\n'));
          process.exit(130);
        }
      };
      process.stdin.prependListener('keypress', cancelKey);
      return {
        message: (text) => spinner.message(compact(text)),
        stop: (text) => { process.stdin.removeListener('keypress', cancelKey); spinner.stop(text); },
        error: (text) => { process.stdin.removeListener('keypress', cancelKey); spinner.error(text); },
      };
    },
    finish(message) { message = format(message); if (tty) p.outro(message); else if (!quiet) process.stderr.write(`${message}\n`); },
    card(title, lines, { error = false } = {}) {
      lines = lines.flatMap(line => format(line).split('\n'));
      if (tty) {
        // Open rails avoid fragile box borders and preserve soft-wrapped commands
        // for copying in narrow terminals. Only the terminal decides line wrapping.
        const rail = pc.dim('│');
        process.stdout.write(`${rail}\n${error ? pc.red('▲') : pc.green('◇')}  ${pc.cyan('▰ ▱')} ${pc.bold(title)}\n${rail}\n${lines.map(line => `${rail}  ${line}`).join('\n')}\n${rail}\n`);
      }
      else if (!quiet) process.stderr.write(`${json ? JSON.stringify({ event: 'card', title, lines }) : `\nTessmora · ${title}\n${lines.join('\n')}\n`}\n`);
    },
    failure(error) { this.card(error.message, [error.hint || '查看日志后重试。', '', '已完成的步骤与资料保留。', '继续配置：', 'tessmora setup'], { error: true }); },
    result(value) { process.stdout.write(`${JSON.stringify(value, (_key, entry) => typeof entry === 'string' ? format(entry) : entry, json ? 0 : 2)}\n`); },
  };
}

export const backOption = { value: BACK, label: '← 返回上一步' };
