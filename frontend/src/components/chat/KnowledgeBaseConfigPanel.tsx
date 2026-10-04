import { useId, useState, useEffect } from 'react'
import { Check, Database, Layers, Route, Search, SlidersHorizontal } from 'lucide-react'
import { WorkflowDialog } from '@/components/ui/WorkflowDialog'
import { useKnowledgeStore } from '@/store/useKnowledgeStore'
import { useConfigStore } from '@/store/useConfigStore'
import { useChatStore, type KbMode } from '@/store/useChatStore'
import './scopeDialogs.css'

interface KnowledgeBaseConfigPanelProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

const modes = [
  { value: 'auto', label: '智能路由', detail: '根据问题选择', Icon: Route },
  { value: 'all', label: '全部知识库', detail: '检索全部内容', Icon: Layers },
  { value: 'manual', label: '手动指定', detail: '选择检索范围', Icon: SlidersHorizontal },
] as const
const contentKinds = [
  { key: 'documents', label: '文档' },
  { key: 'images', label: '图片' },
  { key: 'audio', label: '音频' },
  { key: 'video', label: '视频' },
] as const

export function KnowledgeBaseConfigPanel({ open, onOpenChange }: KnowledgeBaseConfigPanelProps) {
  const { knowledgeBases, fetchKnowledgeBases } = useKnowledgeStore()
  const { updateSystemConfig } = useConfigStore()
  const { getActiveSession, updateSessionKnowledgeBases } = useChatStore()
  const activeSession = getActiveSession()
  const [kbMode, setKbMode] = useState<KbMode>('auto')
  const [selectedKbIds, setSelectedKbIds] = useState<Set<string>>(new Set())
  const [query, setQuery] = useState('')
  const id = useId()

  useEffect(() => {
    if (open) void fetchKnowledgeBases({ silent: true })
  }, [open, fetchKnowledgeBases])

  useEffect(() => {
    if (!open) return
    setKbMode(activeSession?.kbMode ?? 'auto')
    setSelectedKbIds(new Set(activeSession?.knowledgeBaseIds ?? []))
    setQuery('')
  }, [activeSession?.id, activeSession?.knowledgeBaseIds, activeSession?.kbMode, open])

  const toggleKb = (kbId: string) => {
    setSelectedKbIds(previous => {
      const next = new Set(previous)
      if (next.has(kbId)) next.delete(kbId)
      else next.add(kbId)
      return next
    })
  }

  const handleApply = () => {
    if (!activeSession) return
    const ids = kbMode === 'auto' ? [] : kbMode === 'all' ? knowledgeBases.map(kb => kb.id) : [...selectedKbIds]
    updateSessionKnowledgeBases(activeSession.id, ids, kbMode)
    updateSystemConfig({ defaultKnowledgeBaseIds: ids })
    onOpenChange(false)
  }

  const visibleKnowledgeBases = knowledgeBases.filter(kb =>
    `${kb.name} ${kb.description ?? ''}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())
  )
  const summary = kbMode === 'manual'
    ? `已选 ${selectedKbIds.size} 个知识库`
    : kbMode === 'all' ? `检索全部 ${knowledgeBases.length} 个知识库` : '根据问题自动选择知识库'

  return (
    <WorkflowDialog
      eyebrow="对话设置"
      open={open}
      onOpenChange={onOpenChange}
      title="知识库范围"
      description="选择回答时参考的知识库，应用后对当前会话的新问题生效。"
      icon={<Database size={21} strokeWidth={1.7} aria-hidden />}
      size="md"
      className="scope-dialog"
      footer={(
        <>
          <span className="workflow-footer-summary" aria-live="polite">{summary}</span>
          <div className="workflow-footer-actions">
            <button type="button" className="workflow-button" onClick={() => onOpenChange(false)}>取消</button>
            <button
              type="button"
              className="workflow-button-primary"
              onClick={handleApply}
              disabled={!activeSession}
              aria-label={`应用知识库范围：${kbMode === 'manual' ? `指定 ${selectedKbIds.size} 个知识库` : kbMode === 'all' ? '全部知识库' : '智能路由'}`}
            >应用</button>
          </div>
        </>
      )}
    >
      <fieldset className="scope-modes">
        <legend className="workflow-label">检索方式</legend>
        <div className="scope-modes__options">
          {modes.map(({ value, label, detail, Icon }) => (
            <label key={value} htmlFor={`${id}-${value}`} className="scope-mode" data-selected={kbMode === value}>
              <input
                id={`${id}-${value}`}
                className="scope-mode__input"
                type="radio"
                name={`${id}-mode`}
                value={value}
                checked={kbMode === value}
                onChange={() => setKbMode(value)}
                data-autofocus={kbMode === value ? true : undefined}
              />
              <span className="scope-mode__content">
                <span className="scope-mode__top"><Icon size={20} strokeWidth={1.7} aria-hidden /><span className="scope-mode__indicator"><Check size={10} strokeWidth={2.5} aria-hidden /></span></span>
                <span className="scope-mode__label">{label}</span>
                <span className="scope-mode__detail">{detail}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      {kbMode === 'manual' ? (
        <section className="scope-knowledge-list">
          <div className="scope-section-heading"><h3>选择知识库</h3><span>可多选</span></div>
          <div className="workflow-search">
            <Search size={16} strokeWidth={1.7} aria-hidden />
            <input value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索知识库" aria-label="搜索知识库" type="search" />
          </div>
          {visibleKnowledgeBases.length === 0 ? (
            <div className="workflow-empty" role="status">{knowledgeBases.length ? '没有匹配的知识库，试试其他关键词。' : '暂无知识库，创建素材空间并导入内容后即可选择。'}</div>
          ) : (
            <ul className="scope-knowledge-list__rows" role="list" aria-label="可指定的知识库">
              {visibleKnowledgeBases.map(kb => {
                // Index counts are not source file counts; show the actual indexed media kinds.
                const kinds = contentKinds.filter(({ key }) => (kb.stats?.[key] ?? 0) > 0).map(({ label }) => label)
                return (
                  <li key={kb.id}>
                    <label htmlFor={`${id}-kb-${kb.id}`} className="scope-knowledge-row" data-selected={selectedKbIds.has(kb.id)}>
                      <input id={`${id}-kb-${kb.id}`} type="checkbox" className="scope-checkbox" checked={selectedKbIds.has(kb.id)} onChange={() => toggleKb(kb.id)} />
                      <span className="scope-checkbox-fallback" aria-hidden />
                      <span className="scope-knowledge-row__icon" aria-hidden><Database size={17} strokeWidth={1.6} /></span>
                      <span className="scope-knowledge-row__name" title={kb.name}>{kb.name}</span>
                      <span className="scope-knowledge-row__count">{kinds.length ? kinds.join(' · ') : '素材空间'}</span>
                    </label>
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      ) : (
        <div className="scope-explanation">
          {kbMode === 'auto' ? <Route size={19} strokeWidth={1.7} aria-hidden /> : <Layers size={19} strokeWidth={1.7} aria-hidden />}
          <div>
            <h3>{kbMode === 'auto' ? '让问题找到合适的知识库' : '在全部知识库中查找答案'}</h3>
            <p>{kbMode === 'auto' ? '自动判断问题涉及的内容，选择相关知识库进行检索。适合跨主题提问。' : '将当前所有知识库作为检索范围，适合需要综合多个主题的问题。'}</p>
          </div>
        </div>
      )}
    </WorkflowDialog>
  )
}
