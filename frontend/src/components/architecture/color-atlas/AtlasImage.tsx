import * as Dialog from '@radix-ui/react-dialog'
import { ArrowUpRight, X, ZoomIn } from 'lucide-react'
import type { AtlasText } from './AtlasPrimitives'

/** View the shipped source derivative at its natural proportions, without leaving the reader. */
export function AtlasImage({ src, alt, title, caption, text, className = '' }: {
  src: string; alt: string; title: string; caption?: string; text: AtlasText; className?: string
}) {
  return <Dialog.Root>
    <Dialog.Trigger className={`ca-image-trigger ${className}`} aria-label={`${text('放大查看', 'Enlarge')} · ${title}`}>
      <img src={src} alt={alt} loading="lazy" />
      <span className="ca-image-zoom"><ZoomIn size={14} aria-hidden="true" /><span>{text('放大', 'Enlarge')}</span></span>
    </Dialog.Trigger>
    <Dialog.Portal>
      <Dialog.Overlay className="ca-lightbox-overlay" />
      <Dialog.Content className="ca-lightbox" lang={text('zh-CN', 'en')} aria-modal="true">
        <header><div><Dialog.Title>{title}</Dialog.Title><Dialog.Description>{caption ?? text('查看素材的完整画面与细节。', 'Inspect the full composition and its details.')}</Dialog.Description></div><Dialog.Close className="ca-lightbox-close" aria-label={text('关闭大图', 'Close enlarged image')}><X size={20} aria-hidden="true" /></Dialog.Close></header>
        <div className="ca-lightbox-picture"><img src={src} alt={alt} /></div>
        <footer><span>{text('按 Esc 返回，保留阅读位置', 'Esc returns to your reading position')}</span><a href={src} target="_blank" rel="noreferrer">{text('打开图片文件', 'Open image file')}<ArrowUpRight size={14} aria-hidden="true" /></a></footer>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>
}
