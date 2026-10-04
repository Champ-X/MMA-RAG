import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { ChevronDown, Folder, FolderTree, Search, X } from 'lucide-react'
import { WorkflowDialog } from '@/components/ui/WorkflowDialog'
import type { ChatScopeFile } from '@/store/useChatStore'
import { fileScopeKey, formatScopedFileSize, useFileScopeOptions } from './useFileScopeOptions'
import type { KnowledgeBaseFileItem } from './useFileScopeOptions'
import { FileScopeThumbnail, filePresentation } from './FileScopeThumbnail'
import './scopeDialogs.css'

interface FileScopePickerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  value: ChatScopeFile[]
  onChange: (files: ChatScopeFile[]) => void
}

export function FileScopePicker({ open, onOpenChange, value, onChange }: FileScopePickerProps) {
  const { knowledgeBases, filesByKb, loadingKbIds, loadKbFiles, hasLoadedFilesForKb } = useFileScopeOptions(open)
  const [draftSelection, setDraftSelection] = useState<ChatScopeFile[]>([])
  const [query, setQuery] = useState('')
  const [expandedKbIds, setExpandedKbIds] = useState<string[]>([])
  const [failedKbIds, setFailedKbIds] = useState<string[]>([])
  const requestedKbIds = useRef(new Set<string>())
  const initializedGroups = useRef(false)
  const id = useId()

  useEffect(() => {
    if (!open) {
      requestedKbIds.current.clear()
      initializedGroups.current = false
      setFailedKbIds([])
      return
    }
    setDraftSelection(value)
    setQuery('')
  }, [open, value])

  useEffect(() => {
    if (!open || initializedGroups.current || !knowledgeBases.length) return
    initializedGroups.current = true
    const selectedGroups = [...new Set(value.map(file => file.kbId))]
    setExpandedKbIds(selectedGroups)
  }, [open, knowledgeBases, value])

  const requestFiles = useCallback((kbId: string) => {
    requestedKbIds.current.add(kbId)
    setFailedKbIds(previous => previous.filter(id => id !== kbId))
    void loadKbFiles(kbId).catch(() => setFailedKbIds(previous => [...previous, kbId]))
  }, [loadKbFiles])

  useEffect(() => {
    if (!open) return
    for (const kb of knowledgeBases) {
      if (!hasLoadedFilesForKb(kb.id) && !requestedKbIds.current.has(kb.id)) requestFiles(kb.id)
    }
  }, [open, knowledgeBases, hasLoadedFilesForKb, requestFiles])

  const selectedKeySet = useMemo(
    () => new Set(draftSelection.map(file => fileScopeKey(file.kbId, file.fileId))),
    [draftSelection]
  )
  const hasSearch = query.trim().length > 0
  const knowledgeBaseGroups = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    return knowledgeBases.map(kb => {
      const files = filesByKb[kb.id] ?? []
      const matches = !keyword || kb.name.toLowerCase().includes(keyword)
        ? files
        : files.filter(file => `${file.name} ${file.type} ${filePresentation(file).label}`.toLowerCase().includes(keyword))
      return {
        kb, files, matches,
        isExpanded: hasSearch || expandedKbIds.includes(kb.id),
        isLoading: loadingKbIds.includes(kb.id),
        hasLoaded: hasLoadedFilesForKb(kb.id),
        failed: failedKbIds.includes(kb.id),
        selectedCount: draftSelection.filter(file => file.kbId === kb.id).length,
      }
    }).filter(group => !hasSearch || group.matches.length > 0 || group.isLoading || !group.hasLoaded)
  }, [knowledgeBases, filesByKb, query, expandedKbIds, loadingKbIds, hasSearch, hasLoadedFilesForKb, failedKbIds, draftSelection])

  const toggleKb = (kbId: string) => {
    setExpandedKbIds(previous => previous.includes(kbId) ? previous.filter(id => id !== kbId) : [...previous, kbId])
  }

  const toggleFile = (kbId: string, kbName: string, file: KnowledgeBaseFileItem) => {
    const key = fileScopeKey(kbId, file.id)
    setDraftSelection(previous => previous.some(item => fileScopeKey(item.kbId, item.fileId) === key)
      ? previous.filter(item => fileScopeKey(item.kbId, item.fileId) !== key)
      : [...previous, { kbId, kbName, fileId: file.id, name: file.name, type: file.type }])
  }

  const toggleGroup = (kbId: string, kbName: string, files: KnowledgeBaseFileItem[]) => {
    const keys = new Set(files.map(file => fileScopeKey(kbId, file.id)))
    const allSelected = files.every(file => selectedKeySet.has(fileScopeKey(kbId, file.id)))
    setDraftSelection(previous => allSelected
      ? previous.filter(file => !keys.has(fileScopeKey(file.kbId, file.fileId)))
      : [...previous, ...files.filter(file => !selectedKeySet.has(fileScopeKey(kbId, file.id))).map(file => ({ kbId, kbName, fileId: file.id, name: file.name, type: file.type }))])
  }

  return (
    <WorkflowDialog
      eyebrow="对话设置"
      open={open}
      onOpenChange={onOpenChange}
      title="指定检索文件"
      description="从素材空间中选择参考文件，本轮回答将在这些文件中检索。"
      icon={<FolderTree size={21} strokeWidth={1.7} aria-hidden />}
      size="lg"
      className="scope-dialog scope-dialog--files"
      footer={(
        <>
          <div className="workflow-footer-summary scope-file-summary">
            <span aria-live="polite">{draftSelection.length > 0 ? <>已选 <strong>{draftSelection.length}</strong> 个文件</> : '未限定文件范围'}</span>
            {draftSelection.length > 0 && <button type="button" className="workflow-button-quiet" onClick={() => setDraftSelection([])}>清空</button>}
          </div>
          <div className="workflow-footer-actions">
            <button type="button" className="workflow-button" onClick={() => onOpenChange(false)}>取消</button>
            <button type="button" className="workflow-button-primary" onClick={() => { onChange(draftSelection); onOpenChange(false) }}>应用{draftSelection.length > 0 ? ` (${draftSelection.length})` : ''}</button>
          </div>
        </>
      )}
    >
      <div className="scope-file-toolbar">
        <div className="workflow-search">
          <Search size={17} strokeWidth={1.7} aria-hidden />
          <input value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索文件、类型或素材空间" aria-label="搜索检索文件" type="search" data-autofocus />
        </div>
        {draftSelection.length > 0 && (
          <div className="scope-selected-files" aria-label="已选检索文件">
            {draftSelection.map(file => (
              <button
                key={fileScopeKey(file.kbId, file.fileId)}
                type="button"
                title={`${file.kbName} / ${file.name}`}
                aria-label={`移除检索文件：${file.kbName ? `${file.kbName} / ${file.name}` : file.name}`}
                onClick={() => setDraftSelection(previous => previous.filter(item => fileScopeKey(item.kbId, item.fileId) !== fileScopeKey(file.kbId, file.fileId)))}
                className="scope-selected-file"
              ><span>{file.name}</span><X size={12} strokeWidth={1.8} aria-hidden /></button>
            ))}
          </div>
        )}
      </div>

      <div className="scope-section-heading"><h3>{hasSearch ? '搜索结果' : '按素材空间选择'}</h3><span>{hasSearch ? `${knowledgeBaseGroups.reduce((sum, group) => sum + group.matches.length, 0)} 个文件` : `${knowledgeBases.length} 个空间`}</span></div>
      {knowledgeBases.length === 0 ? (
        <div className="workflow-empty" role="status"><Folder size={28} strokeWidth={1.3} aria-hidden /><p>暂无可检索的文件</p><span>创建素材空间并导入内容后，即可在这里选择。</span></div>
      ) : knowledgeBaseGroups.length === 0 ? (
        <div className="workflow-empty" role="status">没有匹配的文件，试试文件名、类型或素材空间名称。</div>
      ) : (
        <div className="scope-file-groups">
          {knowledgeBaseGroups.map(({ kb, files, matches, isExpanded, isLoading, hasLoaded, failed, selectedCount }) => (
            <section key={kb.id} className="scope-file-group" data-expanded={isExpanded}>
              <div className="scope-file-group__header">
                <h4>
                  <button type="button" onClick={() => toggleKb(kb.id)} aria-expanded={isExpanded} aria-controls={`${id}-${kb.id}-files`} aria-label={`知识库：${kb.name}`} className="scope-file-group__toggle" disabled={hasSearch}>
                    <ChevronDown size={15} strokeWidth={1.8} className="scope-file-group__chevron" aria-hidden />
                    <Folder size={18} strokeWidth={1.6} aria-hidden />
                    <span className="scope-file-group__name" title={kb.name}>{kb.name}</span>
                    <span className="scope-file-group__count">{failed ? '加载失败' : !hasLoaded || isLoading ? '加载中…' : `${hasSearch ? matches.length : files.length} 个文件`}</span>
                  </button>
                </h4>
                {selectedCount > 0 && <span className="scope-count-badge">{selectedCount} 已选</span>}
                {isExpanded && matches.length > 0 && <button type="button" className="scope-group-select" onClick={() => toggleGroup(kb.id, kb.name, matches)} aria-label={`${matches.every(file => selectedKeySet.has(fileScopeKey(kb.id, file.id))) ? '取消选择' : '选择'}${kb.name}${hasSearch ? '的匹配文件' : '的全部文件'}`}>{matches.every(file => selectedKeySet.has(fileScopeKey(kb.id, file.id))) ? '取消全选' : '全选'}</button>}
              </div>
              <div id={`${id}-${kb.id}-files`} hidden={!isExpanded} className="scope-file-group__body">
                {failed ? (
                  <div className="scope-group-status"><span>文件列表未能加载。</span><button type="button" className="workflow-button-quiet" onClick={() => requestFiles(kb.id)}>重试</button></div>
                ) : !hasLoaded || (isLoading && matches.length === 0) ? (
                  <div className="scope-group-status">正在加载文件…</div>
                ) : matches.length === 0 ? (
                  <div className="scope-group-status">{hasSearch ? '这个空间中没有匹配的文件。' : '暂无已完成解析的文件。'}</div>
                ) : (
                  <ul className="scope-file-list" role="list">
                    {matches.map(file => {
                      const key = fileScopeKey(kb.id, file.id)
                      const checked = selectedKeySet.has(key)
                      const { label } = filePresentation(file)
                      return (
                        <li key={key}>
                          <label htmlFor={`${id}-file-${key}`} className="scope-file-row" data-selected={checked}>
                            <input id={`${id}-file-${key}`} type="checkbox" className="scope-checkbox" checked={checked} onChange={() => toggleFile(kb.id, kb.name, file)} aria-label={`${kb.name} / ${file.name}`} />
                            <span className="scope-checkbox-fallback" aria-hidden />
                            <FileScopeThumbnail file={file} />
                            <span className="scope-file-row__content"><span className="scope-file-row__name" title={file.name}>{file.name}</span><span className="scope-file-row__meta">{label}<span aria-hidden>·</span>{formatScopedFileSize(file.size)}</span></span>
                            {checked && <span className="scope-file-row__selected">已选</span>}
                          </label>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </div>
            </section>
          ))}
        </div>
      )}
    </WorkflowDialog>
  )
}

export default FileScopePicker
