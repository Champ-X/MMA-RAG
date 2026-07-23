import ReactMarkdown from 'react-markdown'
import type { Components } from 'react-markdown'
import { knowledgeApi } from '@/services/api_client'

interface KnowledgeMarkdownPreviewProps {
  content: string
  kbId?: string
  fileId?: string
}

export function KnowledgeMarkdownPreview({ content, kbId, fileId }: KnowledgeMarkdownPreviewProps) {
  const normalizedContent = content.trim()
  const components: Components = {
    img: ({ src, alt, ...rest }) => {
      const isLocalPath = typeof src === 'string' && (src.startsWith('/') || src.toLowerCase().startsWith('file://'))
      const imgSrc = isLocalPath && kbId && fileId
        ? knowledgeApi.getFilePreviewAssetUrl(kbId, fileId, src)
        : src
      const imageAlt = alt ?? ''
      return (
        <figure className="my-4 overflow-hidden rounded-xl border border-slate-200 bg-slate-50/70 p-2 shadow-sm dark:border-slate-700 dark:bg-slate-900/60">
          <img
            src={imgSrc}
            alt={imageAlt}
            {...rest}
            className="h-auto max-w-full rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-950"
          />
          {imageAlt ? (
            <figcaption className="mt-2 px-1 text-xs leading-5 text-slate-500 dark:text-slate-400">
              {imageAlt}
            </figcaption>
          ) : null}
        </figure>
      )
    },
  }

  if (!normalizedContent) {
    return (
      <div
        className="rounded-xl border border-dashed border-slate-200 bg-slate-50/80 px-4 py-6 text-center text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900/50 dark:text-slate-400"
        role="status"
      >
        Markdown 内容为空。
      </div>
    )
  }

  return (
    <article aria-label="Markdown 文档预览">
      <ReactMarkdown components={components}>{content}</ReactMarkdown>
    </article>
  )
}

export default KnowledgeMarkdownPreview
