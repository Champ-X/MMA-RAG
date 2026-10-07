// Server-rendering tests exercise the real lazy components without a browser's
// stylesheet loader. Visual behavior is checked separately in the browser.
export async function load(url, context, nextLoad) {
  if (url.endsWith('.css')) return { format: 'module', source: 'export default {}', shortCircuit: true }
  return nextLoad(url, context)
}
