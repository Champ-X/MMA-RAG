import * as p from '@clack/prompts';
import { TessmoraError } from './errors.js';
import { brandBanner } from './brand.js';
import { commandFormatter } from './invocation.js';
import { isAccessible } from '@clack/core';
import { choose, enter } from './ui-prompts.js';
import { ink, geometry, paragraph, rule, stepHeading, notice } from './presentation.js';
import { activity } from './ui-spinner.js';

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
        process.stdout.write(brandBanner({ caption: false, responsive: true }));
        process.stdout.write(`${paragraph('Every fragment finds its place.')}\n\n${paragraph('安装与配置', { style: ink.accent })}\n${paragraph('准备你的知识工作台，进度会随步骤保存。', { style: ink.muted })}\n`);
      }
    },
    step(number, title, description) {
      if (tty) process.stdout.write(stepHeading(number, title, description));
      else if (!quiet) process.stderr.write(`${json ? JSON.stringify({ event: 'step', number, title }) : `[${number}/6] ${title}`}\n`);
    },
    info(message) { message = format(message); if (tty) process.stdout.write(notice(message)); else if (!quiet) process.stderr.write(`${json ? JSON.stringify({ event: 'info', message }) : message}\n`); },
    warn(message) { message = format(message); if (tty) process.stdout.write(notice(message, 'warning')); else process.stderr.write(`${json ? JSON.stringify({ event: 'warning', message }) : message}\n`); },
    success(message) { message = format(message); if (tty) process.stdout.write(notice(message, 'success')); else if (!quiet) process.stderr.write(`${json ? JSON.stringify({ event: 'success', message }) : message}\n`); },
    async select(message, options, initialValue) { return check(await choose(format(message), options, { initialValue })); },
    async multiselect(message, options, initialValues) { return check(await choose(format(message), options, { initialValues, multiple: true })); },
    async text(message, initialValue = '', validate) { return check(await enter(format(message), { initialValue, validate })); },
    async password(message) { return check(await enter(format(message), { secret: true })); },
    async confirm(message, initialValue = true) { return check(await choose(format(message), [{ value: true, label: '是，继续' }, { value: false, label: '暂时不用' }], { initialValue })); },
    spinner(message) {
      if (!tty || isAccessible()) {
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
      return activity(format(message), { onCancel: () => {
        process.stderr.write(format('继续配置：tessmora setup\n'));
        process.exit(130);
      } });
    },
    finish(message) { message = format(message); if (tty) process.stdout.write(`\n${rule()}\n${paragraph(message, { style: ink.accent })}\n\n`); else if (!quiet) process.stderr.write(`${message}\n`); },
    card(title, lines, { error = false } = {}) {
      lines = lines.flatMap(line => format(line).split('\n'));
      if (tty) {
        const { margin } = geometry();
        const color = error ? ink.warning : ink.accent;
        // Open-ended content preserves complete, copyable commands and paths.
        // Never truncate diagnostics or add a frame inside a wrapped command.
        process.stdout.write(`\n${rule()}\n${paragraph(`${error ? '! ' : ''}${title}`, { style: text => color(ink.title(text)) })}\n\n${lines.map(line => `${margin}${line}`).join('\n')}\n\n`);
      }
      else if (!quiet) process.stderr.write(`${json ? JSON.stringify({ event: 'card', title, lines }) : `\nTessmora · ${title}\n${lines.join('\n')}\n`}\n`);
    },
    failure(error) { this.card('这一步需要处理', [error.message, '', error.hint || '查看日志后重试。', '', '已完成的步骤与资料保留。', '稍后继续：tessmora setup'], { error: true }); },
    result(value) { process.stdout.write(`${JSON.stringify(value, (_key, entry) => typeof entry === 'string' ? format(entry) : entry, json ? 0 : 2)}\n`); },
  };
}

export const backOption = { value: BACK, label: '← 返回上一步' };
