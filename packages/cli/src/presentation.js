import pc from 'picocolors';
import stringWidth from 'fast-string-width';
import { stripVTControlCharacters } from 'node:util';

// Inherit the terminal background and body color, including light / NO_COLOR
// themes. Cyan belongs to the current choice; green means a completed action.
export const ink = { accent: pc.cyan, title: pc.bold, muted: pc.dim, success: pc.green, warning: pc.yellow, error: pc.red };
export const clean = value => stripVTControlCharacters(String(value)).replace(/\t/g, '    ').replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '');
const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

export function geometry(output = process.stdout) {
  const columns = output.columns || 80;
  const inset = columns >= 40 ? 4 : 2;
  return { margin: ' '.repeat(inset), width: Math.max(1, Math.min(88, columns - inset * 2 - 1)) };
}

export function wrap(value, width) {
  const lines = [];
  for (const paragraph of clean(value).split('\n')) {
    let line = '';
    for (const { segment } of graphemes.segment(paragraph)) {
      if (line && stringWidth(line + segment) > Math.max(1, width)) {
        const space = line.lastIndexOf(' ');
        if (space > 0 && stringWidth(line.slice(0, space)) >= width / 2) {
          lines.push(line.slice(0, space)); line = line.slice(space + 1);
        } else { lines.push(line); line = ''; }
      }
      line += segment;
    }
    lines.push(line);
  }
  return lines;
}

export function paragraph(value, { output = process.stdout, indent = 0, style = text => text } = {}) {
  const { margin, width } = geometry(output);
  return wrap(value, width - indent).map(line => `${margin}${' '.repeat(indent)}${style(line)}`).join('\n');
}

export function rule(output = process.stdout) {
  const { margin, width } = geometry(output);
  return `${margin}${ink.muted('─'.repeat(width))}`;
}

export function receipt(message, value, { cancelled = false, output = process.stdout } = {}) {
  const { margin, width } = geometry(output);
  const icon = cancelled ? ink.warning('−') : ink.success('✓');
  const label = clean(message).replace(/[？?：:]$/, '');
  const answer = cancelled ? '已暂停' : clean(value);
  if (stringWidth(`${label}  ${answer}`) <= width - 3) {
    return `${margin}${icon}  ${ink.muted(label)}  ${cancelled ? answer : ink.title(answer)}\n`;
  }
  return `${paragraph(label, { output, indent: 3, style: ink.muted })}\n${margin}${icon}  ${wrap(answer, width - 3).join(`\n${margin}   `)}\n`;
}

export function instructions(multiple = false, output = process.stdout, input = false) {
  const keys = input ? ['Enter 确认', 'Ctrl+C 暂停'] : ['↑↓ 切换', ...(multiple ? ['Space 勾选'] : []), 'Enter 继续', 'Ctrl+C 暂停'];
  return paragraph(keys.join('   ·   '), { output, style: ink.muted });
}

const stops = ['运行', '能力', '环境', '连接', '模型', '完成'];
export function stepHeading(number, title, description, output = process.stdout) {
  const { margin, width } = geometry(output);
  const full = stringWidth(stops.map((name, index) => `${index + 1} ${name}`).join('   /   ')) <= width;
  const route = stops.map((name, index) => {
    const label = `${index < number - 1 ? '✓' : index + 1}${full ? ` ${name}` : ''}`;
    return index === number - 1 ? ink.accent(ink.title(label)) : ink.muted(label);
  }).join(ink.muted(full ? '   /   ' : width >= 21 ? ' · ' : ' '));
  return `\n${margin}${route}\n${rule(output)}\n\n${paragraph(title, { output, style: ink.title })}${description ? `\n${paragraph(description, { output })}` : ''}\n`;
}

export function notice(message, kind = 'info', output = process.stdout) {
  const { margin, width } = geometry(output);
  const [icon, color] = { info: ['·', ink.accent], success: ['✓', ink.success], warning: ['!', ink.warning] }[kind];
  return `${margin}${color(icon)}  ${wrap(message, width - 3).join(`\n${margin}   `)}\n`;
}
