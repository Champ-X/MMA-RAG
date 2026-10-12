import { stripVTControlCharacters } from 'node:util';
import stringWidth from 'fast-string-width';

export function plainLine(value) {
  return stripVTControlCharacters(String(value)).replace(/[\x00-\x1f\x7f]/g, ' ').replace(/\s+/g, ' ').trim();
}

export function fitLine(value, columns = process.stdout.columns || 80) {
  const text = plainLine(value);
  const limit = Math.max(1, columns);
  if (stringWidth(text) <= limit) return text;
  let result = '';
  for (const { segment } of new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)) {
    if (stringWidth(result + segment) > limit - 1) break;
    result += segment;
  }
  return `${result}…`;
}

export function duration(ms) {
  const seconds = Math.floor(Math.max(0, ms) / 1000);
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`;
}
