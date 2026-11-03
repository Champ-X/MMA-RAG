import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { AlertTriangle, ArrowRight, CheckCircle2, ExternalLink, FileText, Film, Loader2, Music2, RotateCcw, Search, SlidersHorizontal, Square, X } from 'lucide-react'
import * as Dialog from '@radix-ui/react-dialog'
import * as Popover from '@radix-ui/react-popover'
import { translate as t, useTranslation } from '@/i18n'
import { collectionApi, collectionIsRunning, collectionRequestId, collectionWebUrl, type CollectionCapabilities, type CollectionCandidate, type CollectionRun, type CollectionStatus } from '@/services/collection'
import { UploadSourceGlyph } from './UploadSourceGlyph'
import { CollectionAgentGlyph } from './CollectionAgentGlyph'
import './collectionAgent.css'

interface CollectionAgentProps {
  kbId: string
  onImported: () => void | Promise<void>
  onActive?: () => void
  onViewCollected?: () => void
}

function runLabel(status: CollectionStatus) {
  const labels: Record<CollectionStatus, string> = {
    planning: '正在理解需求', searching: '正在寻找素材', review: '选好后收录到当前空间',
    collecting: '正在收录与解析', completed: '收录完成', partial: '部分素材已收录',
    failed: '本次未能完成', cancelled: '已停止查找', interrupted: '任务已中断，可继续处理',
  }
  return t(labels[status])
}

function itemLabel(status: CollectionCandidate['status']) {
  return t({ candidate: '待选择', downloading: '正在下载', processing: '正在解析', ready: '已可检索',
    duplicate: '重复跳过', failed: '收录失败', skipped: '已跳过' }[status])
}

function materialKindLabel(kind: string): string | undefined {
  const label = ({ webpage: '网页', news: '资讯', image: '图片', document: '文档', audio: '音频', video: '视频', file: '文件' } as Record<string, string>)[kind]
  return label ? t(label) : undefined
}

function readableError(error: unknown) {
  return error instanceof Error && error.message ? error.message : t('暂时无法连接素材助手，请稍后重试。')
}

function mergeRuns(previous: CollectionRun[], incoming: CollectionRun[]) {
  const byId = new Map(previous.map(run => [run.id, run]))
  incoming.forEach(run => {
    const old = byId.get(run.id)
    if (!old || run.updated_at >= old.updated_at) byId.set(run.id, run)
  })
  return [...byId.values()].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 20)
}

/** Keying the session makes requests and drafts belong to exactly one knowledge space. */
export function CollectionAgent(props: CollectionAgentProps) {
  return <CollectionAgentSession key={props.kbId} {...props} />
}

function CollectionAgentSession({ kbId, onImported, onActive, onViewCollected }: CollectionAgentProps) {
  useTranslation()
  const id = useId()
  const [prompt, setPrompt] = useState('')
  const [mode, setMode] = useState<'auto' | 'review'>('auto')
  const [maxItems, setMaxItems] = useState(5)
  const [capabilities, setCapabilities] = useState<CollectionCapabilities | null>(null)
  const [runs, setRuns] = useState<CollectionRun[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [pollError, setPollError] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [optionsOpen, setOptionsOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const textarea = useRef<HTMLTextAreaElement>(null)
  const taskButton = useRef<HTMLButtonElement>(null)
  const quantityInput = useRef<HTMLInputElement>(null)
  const optionsContent = useRef<HTMLDivElement>(null)
  const skipOptionsReturnFocus = useRef(false)
  const returnFocus = useRef<HTMLElement | null>(null)
  const viewingCollected = useRef(false)
  const lifetime = useRef<AbortController | null>(null)
  const mutation = useRef(false)
  const draftRequest = useRef<{ fingerprint: string; id: string } | null>(null)
  const selectedIdRef = useRef<string | null>(null)
  const seenResults = useRef(new Map<string, string>())
  const initializedSelection = useRef<string | null>(null)
  const callbacks = useRef({ onImported, onActive })
  callbacks.current = { onImported, onActive }

  const accept = useCallback((incoming: CollectionRun[]) => {
    const owned = incoming.filter(run => run.kb_id === kbId)
    if (!owned.length) return
    setRuns(previous => mergeRuns(previous, owned))
    if (!selectedIdRef.current) {
      const first = owned.find(run => collectionIsRunning(run.status) || run.status === 'review') ?? owned[0]
      selectedIdRef.current = first.id
      setSelectedId(first.id)
    }
    owned.forEach(run => {
      const signature = `${run.counts.ready}:${run.counts.failed}`
      const previous = seenResults.current.get(run.id)
      seenResults.current.set(run.id, signature)
      if (previous !== signature && (run.counts.ready > 0 || run.counts.failed > 0)) {
        void Promise.resolve(callbacks.current.onImported()).catch(() => {})
      }
    })
  }, [kbId])

  const refresh = useCallback(async (signal: AbortSignal) => {
    setLoading(true)
    try {
      const response = await collectionApi.list(kbId, signal)
      if (signal.aborted) return
      accept(response.runs)
      setLoadError(null)
      if (response.runs.some(run => collectionIsRunning(run.status) || run.status === 'review')) callbacks.current.onActive?.()
    } catch (failure) {
      if (!signal.aborted) setLoadError(readableError(failure))
    } finally {
      if (!signal.aborted) setLoading(false)
    }
  }, [accept, kbId])

  useEffect(() => {
    const controller = new AbortController()
    lifetime.current = controller
    void refresh(controller.signal)
    void collectionApi.capabilities(controller.signal).then(value => {
      if (!controller.signal.aborted) setCapabilities(value)
    }).catch(() => { /* Task errors remain actionable; channel discovery is optional. */ })
    return () => { controller.abort(); lifetime.current = null }
  }, [refresh])

  const pollingKey = runs.filter(run => collectionIsRunning(run.status)).map(run => run.id).sort().join(',')
  useEffect(() => {
    if (!pollingKey) return
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    const poll = async () => {
      const outcomes = await Promise.allSettled(pollingKey.split(',').map(runId => collectionApi.get(runId, controller.signal)))
      if (controller.signal.aborted) return
      const received = outcomes.flatMap(outcome => outcome.status === 'fulfilled' ? [outcome.value] : [])
      accept(received)
      setPollError(outcomes.some(outcome => outcome.status === 'rejected'))
      timer = setTimeout(() => { void poll() }, 2000)
    }
    timer = setTimeout(() => { void poll() }, 2000)
    return () => { controller.abort(); if (timer) clearTimeout(timer) }
  }, [accept, pollingKey])

  const run = runs.find(item => item.id === selectedId) ?? null
  const runId = run?.id
  const review = run?.status === 'review'
  const runLimit = run ? Math.max(1, Math.min(run.max_items, run.plan?.target_count ?? run.max_items)) : maxItems
  useEffect(() => {
    if (!run || !review || initializedSelection.current === run.id) return
    initializedSelection.current = run.id
    setSelected(new Set(run.candidates.filter(item => item.status === 'candidate').slice(0, runLimit).map(item => item.id)))
  }, [review, run, runId, runLimit])

  const upperLimit = Math.min(20, capabilities?.limits.max_items ?? 20)
  const running = runs.some(item => collectionIsRunning(item.status))
  const availableChannels = capabilities ? Object.entries(capabilities.channels).filter(([, channel]) => channel.available) : []
  const searchConnected = availableChannels.some(([name]) => name !== 'open_web')
  const selectedCandidates = run?.candidates.filter(item => selected.has(item.id) && item.status === 'candidate') ?? []
  const warnings = [...new Set([...(run?.warnings ?? []), ...(run?.plan?.warnings ?? []), ...(run?.plan?.review_required_reason ? [run.plan.review_required_reason] : [])])]
  const summaryRun = runs.find(item => collectionIsRunning(item.status)) ?? run ?? runs[0]

  const openDialog = () => {
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    skipOptionsReturnFocus.current = true
    setOptionsOpen(false)
    setDialogOpen(true)
  }

  const chooseRun = (nextId: string) => {
    selectedIdRef.current = nextId
    initializedSelection.current = null
    setSelectedId(nextId)
    setSelected(new Set())
    setError(null)
  }

  const perform = async (action: (signal: AbortSignal) => Promise<CollectionRun>) => {
    const signal = lifetime.current?.signal
    if (!signal || signal.aborted || mutation.current) return
    mutation.current = true
    setBusy(true)
    setError(null)
    try {
      const result = await action(signal)
      if (signal.aborted) return
      accept([result])
      chooseRun(result.id)
      if (collectionIsRunning(result.status) || result.status === 'review') callbacks.current.onActive?.()
    } catch (failure) {
      if (!signal.aborted) setError(readableError(failure))
    } finally {
      mutation.current = false
      if (!signal.aborted) setBusy(false)
    }
  }

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (running || mutation.current) return
    if (!prompt.trim()) {
      setError(t('请先描述想要的素材，或粘贴链接。'))
      textarea.current?.focus()
      return
    }
    if (!Number.isInteger(maxItems) || maxItems < 1 || maxItems > upperLimit) {
      setError(t('最多可收录 {{count}} 项素材。', { count: upperLimit }))
      setOptionsOpen(true)
      return
    }
    const fingerprint = JSON.stringify([kbId, prompt.trim(), mode, maxItems])
    if (draftRequest.current?.fingerprint !== fingerprint) draftRequest.current = { fingerprint, id: collectionRequestId() }
    const requestId = draftRequest.current.id
    setCreating(true)
    openDialog()
    void perform(async signal => {
      const result = await collectionApi.create({ kb_id: kbId, prompt: prompt.trim(), mode, max_items: maxItems, client_request_id: requestId }, signal)
      draftRequest.current = null
      return result
    }).finally(() => { if (lifetime.current) setCreating(false) })
  }

  return (
    <Dialog.Root open={dialogOpen} onOpenChange={setDialogOpen}>
    <section className="collection-agent" aria-labelledby={`${id}-heading`}>
      <header className="collection-agent__heading">
        <span className="collection-agent__glyph" aria-hidden><CollectionAgentGlyph /></span>
        <h4 id={`${id}-heading`}>{t('让 Agent 帮你找一找')}</h4>
        {(summaryRun || creating) && <button ref={taskButton} className="collection-agent__task-button" type="button" onClick={openDialog}>
          {t('查看任务')}<ArrowRight size={14} aria-hidden />
        </button>}
      </header>
      {(creating || (summaryRun && summaryRun.status !== 'review')) && <p className="collection-agent__task-status" role="status" aria-live="polite">
        {creating || running ? <Loader2 size={14} className="collection-agent__spin" aria-hidden /> : <Search size={14} aria-hidden />}
        <span>{creating ? t('正在提交…') : summaryRun && runLabel(summaryRun.status)}</span>
      </p>}
      <form className="collection-agent__form" action="/api/collection/runs" method="post" onSubmit={submit}>
        <label className="sr-only" htmlFor={`${id}-prompt`}>{t('想找些什么？')}</label>
        <textarea ref={textarea} id={`${id}-prompt`} name="prompt" required maxLength={2000} rows={4}
          value={prompt} onChange={event => { setPrompt(event.target.value); setError(null) }}
          placeholder={t('描述主题，或粘贴网页链接并说明要找的 PDF、图片、音频或视频。')}
          aria-describedby={error && !dialogOpen ? `${id}-error` : `${id}-hint`} disabled={busy} />
        <div className="collection-agent__examples" aria-label={t('搜索示例')}>
          {([
            ['image', '找参考图片', '找几张清晰的植物叶片照片，用于科普参考'],
            ['news', '收集近期资讯', '收集最近一周人工智能领域的重要资讯，优先原始来源'],
            ['link', '搜集专题资料', '寻找 Agent Harness 的技术资料，优先官方文档和实践文章'],
            ['document', '找文档与音视频', '查找植物生长的公开 PDF、音频或视频素材，优先原始来源'],
          ] as const).map(([glyph, label, value]) => <button key={glyph} type="button" disabled={busy}
            onClick={() => {
              skipOptionsReturnFocus.current = true
              setOptionsOpen(false)
              setPrompt(t(value))
              setError(null)
              textarea.current?.focus()
            }}>
            <UploadSourceGlyph name={glyph} size={18} />{t(label)}</button>)}
        </div>
        <div className="collection-agent__toolbar">
          <Popover.Root open={optionsOpen} onOpenChange={setOptionsOpen}>
            <Popover.Trigger asChild>
              <button className="collection-agent__options-toggle" type="button" disabled={busy}>
                <SlidersHorizontal size={14} aria-hidden />{t('查找选项')}
              </button>
            </Popover.Trigger>
            <Popover.Portal>
              <Popover.Content ref={optionsContent} className="collection-agent collection-agent--options" side="top" align="start" sideOffset={8} collisionPadding={12}
                aria-label={t('查找选项')} onOpenAutoFocus={event => {
                  skipOptionsReturnFocus.current = false
                  event.preventDefault()
                  if (!Number.isInteger(maxItems) || maxItems < 1 || maxItems > upperLimit) {
                    quantityInput.current?.focus()
                  } else optionsContent.current?.querySelector<HTMLInputElement>('input[name="collection_mode"]:checked')?.focus()
                }} onCloseAutoFocus={event => {
                  if (skipOptionsReturnFocus.current) event.preventDefault()
                  skipOptionsReturnFocus.current = false
                }}>
                <div className="collection-agent__options-heading">
                  <strong>{t('查找选项')}</strong>
                  <Popover.Close className="collection-agent__options-close" aria-label={t('关闭查找选项')}><X size={16} aria-hidden /></Popover.Close>
                </div>
                <div className="collection-agent__options-body">
                  <fieldset disabled={busy} className="collection-agent__modes">
                    <legend className="sr-only">{t('收录方式')}</legend>
                    {(['auto', 'review'] as const).map(value => <label key={value} data-selected={mode === value}>
                      <input name="collection_mode" type="radio" value={value} checked={mode === value} onChange={() => setMode(value)} />
                      <span>{t(value === 'auto' ? '自动收录' : '先看候选')}</span>
                    </label>)}
                  </fieldset>
                  <div className="collection-agent__quantity">
                    <label htmlFor={`${id}-quantity`}>{t('最多收录')}</label>
                    <input ref={quantityInput} id={`${id}-quantity`} name="max_items" type="number" inputMode="numeric" min={1} max={upperLimit}
                      value={maxItems || ''} onChange={event => setMaxItems(Number(event.target.value))} disabled={busy} required />
                    <span>{t('项素材')}</span>
                  </div>
                </div>
              </Popover.Content>
            </Popover.Portal>
          </Popover.Root>
          <div className="collection-agent__controls">
            <p id={`${id}-hint`} className="collection-agent__hint">{t('最多 {{count}} 项', { count: maxItems || upperLimit })}</p>
            <button className="collection-agent__submit" type="submit" disabled={busy || running}
              aria-describedby={running ? `${id}-running` : undefined}>
              {creating ? <Loader2 size={16} className="collection-agent__spin" aria-hidden /> : <Search size={16} aria-hidden />}
              {t(creating ? '正在提交…' : '开始查找')}
            </button>
          </div>
        </div>
        {running && <p id={`${id}-running`} className="sr-only">{t('先完成或停止当前任务，再开始新的查找。')}</p>}
        {capabilities && !searchConnected && <p className="collection-agent__notice">{t(capabilities.channels.open_web?.available
          ? '全网搜索尚未连接；可以粘贴公开网页链接并说明需求，查找页面中的素材，或直接导入文件链接。'
          : '搜索渠道尚未连接，可以先粘贴公开网页或文件链接。')}</p>}
      </form>
      {!dialogOpen && error && <div className="collection-agent__error"><AlertTriangle size={15} aria-hidden />
          <p id={`${id}-error`} role="alert">{error}</p>
          <button type="button" disabled={loading} onClick={() => { if (lifetime.current) void refresh(lifetime.current.signal) }}>{t('刷新任务')}</button>
        </div>}
      {loading && <p className="collection-agent__hint" role="status">{t('正在读取任务…')}</p>}
      {loadError && <div className="collection-agent__notice" role="status"><span>{loadError}</span>
        <button type="button" disabled={loading} onClick={() => { if (lifetime.current) void refresh(lifetime.current.signal) }}><RotateCcw size={14} aria-hidden />{t('刷新任务')}</button></div>}
    </section>
    <Dialog.Portal>
      <Dialog.Overlay className="collection-agent__overlay" />
      <Dialog.Content className="collection-agent collection-agent--dialog" aria-modal="true" onCloseAutoFocus={event => {
        event.preventDefault()
        if (viewingCollected.current) { viewingCollected.current = false; return }
        const target = returnFocus.current
        if (target?.isConnected && !target.matches(':disabled')) target.focus()
        else (taskButton.current ?? textarea.current)?.focus()
      }}>
        <header className="collection-agent__dialog-heading">
          <div><Dialog.Title>{t('素材查找任务')}</Dialog.Title>
            <Dialog.Description>{t('关闭弹窗后任务继续，可随时从「查看任务」返回。')}</Dialog.Description></div>
          <Dialog.Close className="collection-agent__close" aria-label={t('关闭任务弹窗')}><X size={19} aria-hidden /></Dialog.Close>
        </header>
        <div className="collection-agent__dialog-body">
          {error && <div className="collection-agent__error"><AlertTriangle size={15} aria-hidden />
          <p id={`${id}-error`} role="alert">{error}</p>
          <button type="button" disabled={loading} onClick={() => { if (lifetime.current) void refresh(lifetime.current.signal) }}>{t('刷新任务')}</button>
        </div>}
          {creating && <div className="collection-agent__pending" role="status"><Loader2 size={20} className="collection-agent__spin" aria-hidden />
            <strong>{t('正在提交…')}</strong><p>{prompt}</p></div>}
      {!creating && runs.length > 1 && <div className="collection-agent__history">
        <label htmlFor={`${id}-history`}>{t('最近的查找')}</label>
        <select id={`${id}-history`} name="collection_run" value={selectedId ?? ''} onChange={event => chooseRun(event.target.value)} disabled={busy}>
          {runs.map(item => <option value={item.id} key={item.id}>{runLabel(item.status)} · {item.prompt.slice(0, 70)}</option>)}
        </select>
      </div>}
      {!creating && run && <div className="collection-agent__run" data-status={run.status}>
        <div className="collection-agent__run-heading">
          <strong role="status" aria-live="polite">{collectionIsRunning(run.status) ? <Loader2 className="collection-agent__spin" size={16} aria-hidden />
            : run.status === 'completed' ? <CheckCircle2 size={16} aria-hidden /> : null}{runLabel(run.status)}</strong>
          {(collectionIsRunning(run.status) || review) && <button type="button" disabled={busy} onClick={() => { void perform(signal => collectionApi.cancel(run.id, signal)) }}>
            <Square size={12} aria-hidden />{t('停止任务')}</button>}
        </div>
        <p className="collection-agent__request">{run.plan?.summary || run.prompt}</p>
        <dl className="collection-agent__counts">
          {([['候选', run.counts.found], ['可检索', run.counts.ready], ['重复跳过', run.counts.duplicate], ['未完成', run.counts.failed]] as const).map(([label, count]) =>
            <div key={label}><dt>{t(label)}</dt><dd>{count}</dd></div>)}
        </dl>
        {run.message && <p className="collection-agent__hint">{run.message}</p>}
        {pollError && collectionIsRunning(run.status) && <p role="status" className="collection-agent__notice">{t('暂时无法更新进度，后台任务可能仍在继续。')}</p>}
        {warnings.length > 0 && <details className="collection-agent__warnings"><summary>{t('任务提示')} ({warnings.length})</summary>
          <ul>{warnings.map(warning => <li key={warning}>{warning}</li>)}</ul></details>}
        {run.candidates.length > 0 && <ul className="collection-agent__candidates" aria-label={t('发现的素材')}>
          {run.candidates.map(candidate => {
            const url = collectionWebUrl(candidate.url)
            const thumbnail = collectionWebUrl(candidate.thumbnail_url)
            const originalFile = collectionWebUrl(candidate.download_url)
            // A requested format alone is not evidence that a file was found.
            const pdfFile = candidate.kind === 'document' && originalFile &&
              (candidate.required_format === 'pdf' || (candidate.status !== 'ready' && new URL(originalFile).pathname.toLowerCase().endsWith('.pdf')))
            const kindLabel = pdfFile ? candidate.status === 'ready' ? 'PDF' : t('PDF 候选') : materialKindLabel(candidate.kind)
            const selectable = review && candidate.status === 'candidate'
            const checked = selected.has(candidate.id)
            return <li className="collection-agent__candidate" key={candidate.id} data-status={candidate.status}>
              {selectable && <label className="collection-agent__check"><input type="checkbox" name="candidate_ids" value={candidate.id}
                checked={checked} disabled={busy || (!checked && selectedCandidates.length >= runLimit)}
                aria-label={t('选择素材：{{title}}', { title: candidate.title })} onChange={event => setSelected(previous => {
                  const next = new Set(previous)
                  if (event.target.checked) next.add(candidate.id); else next.delete(candidate.id)
                  return next
                })} /></label>}
              <div className="collection-agent__thumbnail" data-kind={candidate.kind}>
                {thumbnail ? <img src={thumbnail} alt="" loading="lazy" referrerPolicy="no-referrer" onError={event => { event.currentTarget.hidden = true }} />
                  : candidate.kind === 'audio' ? <Music2 size={24} aria-hidden />
                    : candidate.kind === 'video' ? <Film size={24} aria-hidden />
                      : candidate.kind === 'document' || candidate.kind === 'file' ? <FileText size={24} aria-hidden />
                        : <UploadSourceGlyph name={candidate.kind === 'image' ? 'image' : candidate.kind === 'news' ? 'news' : 'link'} size={25} />}
              </div>
              <div className="collection-agent__candidate-copy">
                <div className="collection-agent__candidate-title">{url ? <a href={url} target="_blank" rel="noopener noreferrer" aria-label={t('查看原始来源：{{title}}', { title: candidate.title })}>
                  {candidate.title || url}<ExternalLink size={12} aria-hidden /></a> : <span>{candidate.title}</span>}</div>
                <p className="collection-agent__candidate-meta">{kindLabel ? `${kindLabel} · ` : ''}{url ? new URL(url).hostname : t('原始来源')}
                  {candidate.author && ` · ${candidate.author}`}{candidate.published_at && ` · ${candidate.published_at.slice(0, 10)}`}
                  {candidate.width && candidate.height ? ` · ${candidate.width} × ${candidate.height}` : null}</p>
                {(candidate.reason || candidate.selection_reason || candidate.description) && <p className="collection-agent__candidate-description">{candidate.reason || candidate.selection_reason || candidate.description}</p>}
                {candidate.license && <p className="collection-agent__candidate-meta">{candidate.license}</p>}
                {originalFile && (originalFile !== url || pdfFile) && ['document', 'audio', 'video', 'file'].includes(candidate.kind) &&
                  <a className="collection-agent__original-file" href={originalFile} target="_blank" rel="noopener noreferrer"
                    aria-label={t(pdfFile ? '打开 PDF 原文：{{title}}' : '查看原始文件：{{title}}', { title: candidate.title })}>
                    {t(pdfFile ? '打开 PDF 原文' : '查看原始文件')}<ExternalLink size={11} aria-hidden /></a>}
                {Boolean(candidate.warnings?.length) && <details className="collection-agent__candidate-notes">
                  <summary>{t('素材提示')} ({candidate.warnings!.length})</summary>
                  <ul>{candidate.warnings!.map((warning, index) => <li key={`${index}:${warning}`}>{warning}</li>)}</ul>
                </details>}
                <span className="collection-agent__item-status">{candidate.status === 'ready' && <CheckCircle2 size={12} aria-hidden />}{itemLabel(candidate.status)}</span>
                {candidate.error && <p className="collection-agent__item-error">{candidate.error}</p>}
              </div>
            </li>
          })}
        </ul>}
        {!run.candidates.length && !collectionIsRunning(run.status) && run.status !== 'cancelled' && <p className="collection-agent__hint">{t('没有找到符合条件的素材。可以调整需求后再试。')}</p>}
        {run.status === 'cancelled' && <p className="collection-agent__hint">{t('已停止新增收录；已经保存的素材会保留。')}</p>}
      </div>}
        </div>
        {!creating && run && <footer className="collection-agent__dialog-footer">
        <div className="collection-agent__result-actions">
          {review && <><span>{t('已选 {{count}} / {{limit}} 项', { count: selectedCandidates.length, limit: runLimit })}</span>
            <button className="collection-agent__submit" type="button" disabled={busy || !selectedCandidates.length} onClick={() => {
              if (!selectedCandidates.length) { setError(t('请至少选择一项素材。')); return }
              void perform(signal => collectionApi.collect(run.id, selectedCandidates.map(candidate => candidate.id), signal))
            }}>{t('收录所选素材')}<ArrowRight size={15} aria-hidden /></button></>}
          {(run.status === 'partial' ? run.counts.failed > 0 : ['failed', 'interrupted', 'cancelled'].includes(run.status)) && <button type="button" disabled={busy || running}
            onClick={() => { void perform(signal => collectionApi.retry(run.id, signal)) }}><RotateCcw size={14} aria-hidden />{t(run.status === 'interrupted' || run.status === 'cancelled' ? '继续处理' : '重试未完成项')}</button>}
          {run.status === 'partial' && run.counts.failed === 0 && <button type="button" disabled={busy || running}
            onClick={() => { setPrompt(run.prompt); setError(null); returnFocus.current = textarea.current; setDialogOpen(false) }}>{t('调整需求再查找')}<Search size={14} aria-hidden /></button>}
          {run.counts.ready > 0 && onViewCollected && <button type="button" onClick={() => { viewingCollected.current = true; setDialogOpen(false); onViewCollected() }}>{t('查看已收录')}<ArrowRight size={14} aria-hidden /></button>}
        </div>
        </footer>}
      </Dialog.Content>
    </Dialog.Portal>
    </Dialog.Root>
  )
}
