import { useRef, type FormEventHandler, type ReactNode } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'
import './workflowDialog.css'

interface WorkflowDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  eyebrow?: string
  description?: ReactNode
  icon?: ReactNode
  size?: 'sm' | 'md' | 'lg' | 'xl'
  footer?: ReactNode
  children: ReactNode
  className?: string
  busy?: boolean
  onSubmit?: FormEventHandler<HTMLFormElement>
}

/** Shared, accessible frame for the material and conversation workflows. */
export function WorkflowDialog({
  open, onOpenChange, title, eyebrow, description, icon, size = 'md', footer,
  children, className, busy = false, onSubmit,
}: WorkflowDialogProps) {
  const returnFocusRef = useRef<HTMLElement | null>(null)
  const contentRef = useRef<HTMLDivElement | null>(null)
  const contents = (
    <>
      <div className="workflow-dialog-body">{children}</div>
      {footer && <footer className="workflow-dialog-footer">{footer}</footer>}
    </>
  )

  return (
    <Dialog.Root open={open} onOpenChange={(next) => { if (!busy || next) onOpenChange(next) }}>
      <Dialog.Portal>
        <Dialog.Overlay className="workflow-dialog-overlay" />
        <Dialog.Content
          ref={contentRef}
          className={cn('workflow-dialog', className)}
          data-size={size}
          {...(!description ? { 'aria-describedby': undefined } : {})}
          onOpenAutoFocus={(event) => {
            returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
            const preferred = contentRef.current?.querySelector<HTMLElement>('[data-autofocus]')
            if (preferred) { event.preventDefault(); preferred.focus() }
          }}
          onCloseAutoFocus={(event) => {
            const target = returnFocusRef.current
            if (target?.isConnected) { event.preventDefault(); target.focus() }
          }}
          onEscapeKeyDown={(event) => { if (busy) event.preventDefault() }}
          onPointerDownOutside={(event) => { if (busy) event.preventDefault() }}
        >
          <header className="workflow-dialog-header">
            <div className="workflow-dialog-heading">
              {eyebrow && <div className="workflow-dialog-eyebrow">{eyebrow}</div>}
              <Dialog.Title>{title}</Dialog.Title>
              {description && <Dialog.Description asChild><div className="workflow-dialog-description">{description}</div></Dialog.Description>}
            </div>
            {icon && <div className="workflow-dialog-art" aria-hidden="true">
              <span className="workflow-dialog-sheet workflow-dialog-sheet--back" />
              <span className="workflow-dialog-sheet workflow-dialog-sheet--middle" />
              <span className="workflow-dialog-icon">{icon}<span className="workflow-dialog-icon-rule" /></span>
            </div>}
            <Dialog.Close className="workflow-dialog-close" disabled={busy} aria-label={`关闭${title}`}>
              <X size={18} strokeWidth={1.7} aria-hidden="true" />
            </Dialog.Close>
          </header>
          {onSubmit ? (
            <form className="workflow-dialog-layout" onSubmit={onSubmit} aria-busy={busy}>{contents}</form>
          ) : (
            <div className="workflow-dialog-layout" aria-busy={busy}>{contents}</div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
