import { basename, relative, resolve, isAbsolute } from 'node:path';

export function shellQuote(value, platform = process.platform) {
  const text = String(value);
  if (/^[\w./:@+-]+$/.test(text)) return text;
  return platform === 'win32' ? `"${text.replaceAll('"', '\\"')}"` : `'${text.replaceAll("'", "'\\''")}'`;
}

// Never repeat credentials, proxy URLs or arbitrary command-line options in hints.
export function commandFormatter(options = {}, { entry = process.argv[1], cwd = process.cwd(), platform = process.platform, env = process.env } = {}) {
  const script = entry ? relative(cwd, resolve(entry)) : '';
  const executable = !entry || /^tessmora(?:\.cmd)?$/.test(basename(entry)) ? 'tessmora'
    : `node ${shellQuote(script && !script.startsWith('..') && !isAbsolute(script) ? script : resolve(entry), platform)}`;
  const home = options.home || env.TESSMORA_HOME;
  const scope = `${home ? ` --home ${shellQuote(resolve(home), platform)}` : ''}${options.instance && options.instance !== 'default' ? ` --instance ${shellQuote(options.instance, platform)}` : ''}`;
  return (text) => String(text).replace(/\btessmora (setup|configure|start|stop|status|logs|doctor|open)\b/g, (_, command) => `${executable} ${command}${scope}`);
}
