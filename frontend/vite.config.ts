import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import packageJson from './package.json'

const srcDir = new URL('./src', import.meta.url).pathname

const deferredPreloadChunks = [
  'ArchitecturePage',
  'CitationPopover',
  'FileScopePicker',
  'InspectorDrawer',
  'KnowledgeBaseConfigPanel',
  'ManualInputModal',
  'ModelConfigPanel',
  'charts',
  'editor',
  'markdown',
  'spreadsheet',
]

function shouldDeferPreload(dep: string) {
  return deferredPreloadChunks.some((chunk) => dep.includes(`${chunk}-`))
}

function manualChunks(id: string) {
  if (id.includes('vite/preload-helper') || id.includes('commonjsHelpers')) {
    return 'vendor'
  }

  if (!id.includes('node_modules')) return

  if (
    /node_modules\/(react|react-dom|react-router|react-router-dom|scheduler|use-sync-external-store|zustand)\//.test(id)
  ) {
    return 'vendor'
  }
  if (/node_modules\/(react-markdown|remark-gfm|remark-math|rehype-katex|rehype-highlight|remark-parse|remark-rehype|unified|micromark|mdast-util-|hast-util-|unist-util-|vfile|bail|trough|property-information|space-separated-tokens|comma-separated-tokens|html-void-elements|decode-named-character-reference|character-entities|katex|highlight\.js)\//.test(id)) {
    return 'markdown'
  }
  if (/node_modules\/(md-editor-rt|codemirror|@codemirror|@lezer|crelt|style-mod|w3c-keyname)\//.test(id)) {
    return 'editor'
  }
  if (/node_modules\/(xlsx|cfb|codepage|crc-32|ssf|wmf|word)\//.test(id)) {
    return 'spreadsheet'
  }
  if (/node_modules\/(recharts|d3|d3-|victory-vendor|framer-motion|motion-dom|motion-utils)\//.test(id)) {
    return 'charts'
  }
}

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': srcDir,
    },
  },
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
        secure: false,
        timeout: 180000,
        proxyTimeout: 180000,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    modulePreload: {
      resolveDependencies(_filename, deps) {
        return deps.filter((dep) => !shouldDeferPreload(dep))
      },
    },
    rollupOptions: {
      output: {
        manualChunks,
      },
    },
  },
  define: {
    __APP_VERSION__: JSON.stringify(packageJson.version),
  },
})
