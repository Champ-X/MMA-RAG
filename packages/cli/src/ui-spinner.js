import { block } from '@clack/core';
import { cursorTo, moveCursor, clearScreenDown } from 'node:readline';
import stringWidth from 'fast-string-width';
import { geometry, ink, clean, notice } from './presentation.js';
import { fitLine, duration } from './terminal.js';

const segments = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
function rowsFor(text, columns) {
  let rows = 1, used = 0;
  for (const { segment } of segments.segment(clean(text))) {
    const width = stringWidth(segment);
    if (used + width > columns) { rows++; used = 0; }
    used += width;
  }
  return rows;
}

// Keep one frame on screen, including after a terminal resize. The old spinner
// cached its initial width, leaving wrapped copies behind in split terminals.
export function activity(message, { input = process.stdin, output = process.stdout, onCancel } = {}) {
  const started = performance.now();
  const frames = ['◇', '◈', '◆', '◈'];
  let previous = '', tick = 0, finished = false;
  const unblock = block({ input, output, hideCursor: true });
  const clear = () => {
    if (!previous) return;
    const rows = rowsFor(previous, Math.max(1, output.columns || 80));
    if (rows > 1) moveCursor(output, 0, -(rows - 1));
    cursorTo(output, 0); clearScreenDown(output); previous = '';
  };
  const render = () => {
    if (finished) return;
    clear();
    const { margin, width } = geometry(output);
    const time = duration(performance.now() - started);
    const available = Math.max(1, width - time.length - 5);
    const text = fitLine(message, available);
    previous = `${margin}${ink.accent(frames[tick++ % frames.length])}  ${text}${' '.repeat(Math.max(0, available - stringWidth(text)))}  ${ink.muted(time)}`;
    output.write(previous);
  };
  const cleanup = () => {
    if (finished) return false;
    finished = true;
    clearInterval(timer); clear();
    input.removeListener('keypress', keypress);
    output.removeListener('resize', render);
    process.removeListener('SIGINT', cancel);
    process.removeListener('SIGTERM', cancel);
    process.removeListener('exit', cleanup);
    unblock();
    return true;
  };
  const cancel = () => {
    if (!cleanup()) return;
    output.write(notice('已暂停，进度与下载缓存已保留。', 'warning', output));
    onCancel?.();
  };
  const keypress = (_value, key = {}) => {
    if (key.sequence === '\u0003' || key.name === 'escape') cancel();
  };
  const timer = setInterval(render, 140);
  input.prependListener('keypress', keypress);
  output.on('resize', render);
  process.once('SIGINT', cancel);
  process.once('SIGTERM', cancel);
  process.once('exit', cleanup);
  render();
  const finish = (text, kind) => {
    if (cleanup()) output.write(notice(`${text}  ·  ${duration(performance.now() - started)}`, kind, output));
  };
  return {
    message(text) { message = text; render(); },
    stop: text => finish(text, 'success'),
    error: text => finish(text, 'warning'),
  };
}
