import { ArrowLeft, MoreHorizontal, Pencil, Trash2 } from 'lucide-react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import './knowledgeDetailHeader.css'

interface KnowledgeDetailHeaderProps {
  name: string
  description?: string
  onBack: () => void
  onEdit: () => void
  onDelete: () => void
}

export function KnowledgeDetailHeader({ name, description, onBack, onEdit, onDelete }: KnowledgeDetailHeaderProps) {
  const subtitle = description?.trim()

  return (
    <header className="knowledge-detail-header">
      <div className="knowledge-detail-header__inner">
        <span className="knowledge-detail-header__volume" aria-hidden="true">
          <span className="knowledge-detail-header__pages" />
          <span className="knowledge-detail-header__cover"><span /></span>
        </span>

        <div className="knowledge-detail-header__identity">
          <nav className="knowledge-detail-header__breadcrumb" aria-label="知识库导航">
            <button type="button" onClick={onBack} aria-label="返回知识库列表" title="返回知识库列表">
              <ArrowLeft size={20} strokeWidth={1.8} aria-hidden />
              <span>知识库</span>
            </button>
          </nav>
          <div className="knowledge-detail-header__title-line">
            <h1 title={name}>{name}</h1>
            {subtitle ? <p className="knowledge-detail-header__description" title={subtitle}>{subtitle}</p> : null}
          </div>
        </div>

        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button type="button" className="knowledge-detail-header__manage" aria-label={`更多操作：${name}`} title="更多操作">
              <MoreHorizontal size={21} strokeWidth={1.9} aria-hidden />
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content className="knowledge-detail-menu" align="end" sideOffset={8} collisionPadding={12}>
              <DropdownMenu.Item className="knowledge-detail-menu__item" onSelect={onEdit}>
                <Pencil size={15} strokeWidth={1.7} aria-hidden />编辑知识库
              </DropdownMenu.Item>
              <DropdownMenu.Separator className="knowledge-detail-menu__separator" />
              <DropdownMenu.Item className="knowledge-detail-menu__item knowledge-detail-menu__item--danger" onSelect={onDelete}>
                <Trash2 size={15} strokeWidth={1.7} aria-hidden />删除知识库
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>
    </header>
  )
}
