import pc from 'picocolors';
import { ICE_BLUE_ATTRIBUTES, ICE_BLUE_GLYPHS } from './brand-art.js';

const TAGLINE = 'Every fragment finds its place.';
const PALETTE = [
  '0;0;0', '0;0;170', '0;170;0', '0;170;170',
  '170;0;0', '170;0;170', '170;85;0', '170;170;170',
  '85;85;85', '85;85;255', '85;255;85', '85;255;255',
  '255;85;85', '255;85;255', '255;255;85', '255;255;255',
];
const ANSI_ORDER = [0, 4, 2, 6, 1, 5, 3, 7];
const EMPTY = [' ', ICE_BLUE_ATTRIBUTES.indexOf(7)];

// Sample character/color pairs together so the smaller art keeps its highlights.
// Two 20% reductions give 64% of the source: 89 columns by 8 rows.
const WORDMARK_SCALE = 0.64;
function compactGlyph(rows) {
  const sourceWidth = Math.max(...rows.map(([text]) => text.length));
  const width = Math.round(sourceWidth * WORDMARK_SCALE);
  const height = Math.round(rows.length * WORDMARK_SCALE);
  return Array.from({ length: height }, (_, y) => {
    const [text, attributes] = rows[Math.floor((y + 0.5) * rows.length / height)];
    const columns = Array.from({ length: width }, (_, x) => Math.floor((x + 0.5) * sourceWidth / width));
    return [
      columns.map(x => text[x] ?? EMPTY[0]).join(''),
      columns.map(x => attributes[x] ?? String(EMPTY[1])).join(''),
    ];
  });
}

const GLYPHS = Object.fromEntries(Object.entries(ICE_BLUE_GLYPHS).map(([letter, rows]) => [letter, compactGlyph(rows)]));

function wordmark(word) {
  const glyphs = [...word].map(letter => GLYPHS[letter]);
  const widths = glyphs.map(rows => Math.max(...rows.map(([text]) => text.length)));
  return Array.from({ length: glyphs[0].length }, (_, row) => glyphs.flatMap((rows, index) => {
    const [text, attributes] = rows[row];
    const cells = Array.from({ length: widths[index] }, (_, column) =>
      column < text.length ? [text[column], Number(attributes[column])] : EMPTY);
    return index ? [EMPTY, ...cells] : cells;
  }));
}

const LAYOUTS = [
  ['TESSMORA'],
  ['TESS', 'MORA'],
  ['TE', 'SS', 'MO', 'RA'],
  [...'TESSMORA'],
].map(words => words.map(wordmark));

function colorCode(attribute, trueColor) {
  const foreground = attribute & 15;
  const background = (attribute >> 4) & 7;
  // Black in the source artwork is transparent; retain colored glyph fills.
  if (trueColor) {
    const bg = background === 0 ? '49' : `48;2;${PALETTE[background]}`;
    return `\x1b[0;38;2;${PALETTE[foreground]};${bg}m`;
  }
  const fg = (foreground < 8 ? 30 : 90) + ANSI_ORDER[foreground % 8];
  const bg = background === 0 ? 49 : 40 + ANSI_ORDER[background];
  return `\x1b[0;${fg};${bg}m`;
}

export function brandBanner({
  columns = process.stdout.columns || 80,
  colors = pc,
  colorDepth = process.stdout.getColorDepth?.() || (/truecolor|24bit/i.test(process.env.COLORTERM || '') ? 24 : 4),
} = {}) {
  const width = Math.max(1, Math.floor(Number(columns)) || 80);
  const margin = width >= 30 ? '  ' : '';
  const padding = width >= 28 ? '  ' : '';
  const available = width - margin.length - padding.length * 2;
  const layout = LAYOUTS.find(blocks => blocks.every(rows => rows[0].length <= available));
  // Below one glyph's width, retain the full name without clipping a large letter.
  if (!layout) {
    const name = 'TESSMORA'.match(new RegExp(`.{1,${width}}`, 'g')).join('\n');
    return `\n${colors.cyan(name)}\n\n`;
  }

  const useColor = Boolean(colors.isColorSupported);
  const styles = ICE_BLUE_ATTRIBUTES.map(attribute => colorCode(attribute, colorDepth >= 24));
  const background = useColor ? colorCode(7, colorDepth >= 24) : '';
  const reset = useColor ? '\x1b[0m' : '';
  const contentWidth = Math.max(...layout.map(rows => rows[0].length));
  const panelWidth = contentWidth + padding.length * 2;
  const blank = `${margin}${background}${' '.repeat(panelWidth)}${reset}`;
  const lines = [blank];

  for (const [index, rows] of layout.entries()) {
    if (index) lines.push(blank);
    for (const row of rows) {
      let text = `${margin}${background}${padding}`;
      let previous = -1;
      for (const [character, attribute] of row) {
        if (useColor && attribute !== previous) text += styles[attribute];
        text += character;
        previous = attribute;
      }
      lines.push(`${text}${background}${' '.repeat(contentWidth - row.length)}${padding}${reset}`);
    }
  }
  lines.push(blank);

  const captionWidth = width - margin.length;
  const caption = [];
  for (const word of TAGLINE.split(' ')) {
    const previous = caption.at(-1);
    if (previous && previous.length + word.length + 1 <= captionWidth) caption[caption.length - 1] += ` ${word}`;
    else caption.push(word);
  }
  return `\n${lines.join('\n')}\n\n${caption.map(line => `${margin}${colors.dim(line)}`).join('\n')}\n\n`;
}
