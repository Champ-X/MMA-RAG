import type { ReactNode } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { Expand, X } from 'lucide-react'
import type { AtlasText } from './AtlasPrimitives'

/** A second rendering of the same semantic diagram, with readable, uncompressed type. */
export function AtlasDiagram({ title, text, children }: { title: string; text: AtlasText; children: ReactNode }) {
  return <Dialog.Root>
    <Dialog.Trigger className="ca-diagram-trigger"><Expand size={15} aria-hidden="true" />{text('放大阅读图示', 'Read the enlarged diagram')}</Dialog.Trigger>
    <Dialog.Portal>
      <Dialog.Overlay className="ca-lightbox-overlay" />
      <Dialog.Content className="ca-lightbox ca-diagram-dialog" lang={text('zh-CN', 'en')} aria-modal="true">
        <header><div><Dialog.Title>{title}</Dialog.Title><Dialog.Description>{text('完整结构，独立阅读。小屏幕可横向滚动查看。', 'Read the complete structure in its own space. Scroll horizontally on smaller screens.')}</Dialog.Description></div><Dialog.Close className="ca-lightbox-close" aria-label={text('关闭图示', 'Close diagram')}><X size={20} aria-hidden="true" /></Dialog.Close></header>
        <div className="ca-diagram-scroll" tabIndex={0} role="region" aria-label={title}><div className="color-atlas ca-diagram-atlas" lang={text('zh-CN', 'en')}><div className="ca-sys-unit">{children}</div></div></div>
        <footer>{text('按 Esc 返回，保留阅读位置', 'Esc returns to your reading position')}</footer>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>
}
