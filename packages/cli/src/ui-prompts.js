import { SelectPrompt, MultiSelectPrompt, TextPrompt, PasswordPrompt } from '@clack/core';
import { limitOptions } from '@clack/prompts';
import { wrapTextWithPrefix } from '@clack/core';
import stringWidth from 'fast-string-width';
import { ink, clean, geometry, wrap, paragraph, rule, receipt, instructions } from './presentation.js';

function choice(option, active, selected, multiple, output) {
  const { margin, width } = geometry(output);
  const label = clean(option.label ?? option.value);
  const badge = option.badge || (option.hint?.startsWith('推荐 · ') ? '推荐' : '');
  const hint = badge && option.hint?.startsWith('推荐 · ') ? option.hint.slice(5) : option.hint;
  const mark = multiple ? selected ? '■' : '□' : active ? '◆' : '◇';
  const title = wrap(`${label}${badge ? `  · ${badge}` : ''}`, width - 5);
  const style = option.disabled ? ink.muted : active ? text => ink.accent(ink.title(text)) : text => text;
  if (active) {
    const edge = ink.accent;
    const heading = `${multiple ? `${selected ? '■' : '□'} ` : ''}${label}${badge ? `  · ${badge}` : ''}`;
    const titles = wrap(heading, width - 6);
    const first = titles.shift();
    const content = [...titles, ...(hint ? wrap(hint, width - 6) : [])];
    return [
      `${margin}${edge('╭─ ')}${style(first)}${edge(` ${'─'.repeat(Math.max(0, width - stringWidth(first) - 5))}╮`)}`,
      ...content.map(line => `${margin}${edge('│')}  ${line}${' '.repeat(Math.max(0, width - stringWidth(line) - 4))}${edge('│')}`),
      `${margin}${edge(`╰${'─'.repeat(Math.max(0, width - 2))}╯`)}`,
    ].join('\n');
  }
  const lines = [`${margin}${active ? ink.accent('›') : ' '} ${style(mark)}  ${style(title[0])}`,
    ...title.slice(1).map(line => `${margin}     ${style(line)}`)];
  if (hint) lines.push(...wrap(hint, width - 5).map(line => `${margin}     ${option.disabled ? ink.muted(line) : line}`));
  return `${lines.join('\n')}\n`;
}

export async function choose(message, options, { initialValue, initialValues, multiple = false, output = process.stdout, input = process.stdin } = {}) {
  const Prompt = multiple ? MultiSelectPrompt : SelectPrompt;
  return new Prompt({
    options, initialValue, initialValues, required: multiple, input, output,
    validate: multiple ? value => value.length ? undefined : '至少选择一项，按 Space 勾选。' : undefined,
    render() {
      if (this.state === 'cancel') return receipt(message, '', { cancelled: true, output });
      if (this.state === 'submit') {
        const selected = multiple ? this.options.filter(option => this.value.includes(option.value)) : [this.options[this.cursor]];
        return receipt(message, selected.map(option => option.label ?? option.value).join('、'), { output });
      }
      const heading = paragraph(message, { output, style: ink.title });
      const footer = instructions(multiple, output);
      const error = this.state === 'error' ? `\n${paragraph(this.error, { output, style: ink.warning })}` : '';
      const list = limitOptions({
        cursor: this.cursor, options: this.options, output, columnPadding: 0,
        rowPadding: heading.split('\n').length + footer.split('\n').length + error.split('\n').length + 4,
        style: (option, active) => choice(option, active, multiple && this.value.includes(option.value), multiple, output),
      });
      return `\n${heading}\n\n${list.join('\n')}\n${footer}${error}\n`;
    },
  }).prompt();
}

export async function enter(message, { initialValue = '', validate, secret = false, output = process.stdout, input = process.stdin } = {}) {
  const Prompt = secret ? PasswordPrompt : TextPrompt;
  return new Prompt({
    initialValue, validate, input, output, ...(secret ? { mask: '•' } : {}),
    render() {
      if (this.state === 'cancel') return receipt(message, '', { cancelled: true, output });
      // Never put a credential (including its prefix or length) in the transcript.
      if (this.state === 'submit') return receipt(message, secret ? '已填写' : this.value, { output });
      const { margin } = geometry(output);
      const value = wrapTextWithPrefix(output, this.userInputWithCursor, `${margin}  `, `${margin}${ink.accent('›')} `);
      const error = this.state === 'error' ? `\n${paragraph(this.error, { output, style: ink.warning })}` : '';
      return `\n${paragraph(message, { output, style: ink.title })}\n\n${value}\n${rule(output)}${error}\n${instructions(false, output, true)}\n`;
    },
  }).prompt();
}
