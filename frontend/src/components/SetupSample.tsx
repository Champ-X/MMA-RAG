import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { CheckCircle2, Copy, FileText, Loader2 } from 'lucide-react'
import { knowledgeApi } from '@/services/api_client'
import { useTranslation } from '@/i18n'

const KEY = 'tessmora.setup-sample'
const question = '什么情况下必须回滚？回滚后如何验证？'
const document = `# 星河发布平台：回滚运行手册

本文档是 Tessmora 的合成入门示例，不描述任何真实系统或用户。

## 触发条件
灰度期间若 5xx 错误率连续 5 分钟高于 2%，或发布引发 P1 事件，发布负责人必须立即停止扩容并启动回滚。单次探针失败只暂停发布，不自动回滚。

## 操作与验证
目标是在触发后的 10 分钟内完成回滚。先冻结新版本流量，再把活动版本指向最近一个稳定版本。切换后连续执行 3 次 /ready 健康检查；全部通过后观察错误率和 P95 延迟 15 分钟。验证期内指标再次越线时，保持旧版本并升级给事故指挥官。
`
interface SampleState { kbId: string; taskId?: string; done?: boolean }
function readSample(): SampleState | null {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) || 'null')
    return value && typeof value.kbId === 'string' ? value : null
  } catch { return null }
}

export function SetupSample() {
  const { t } = useTranslation()
  const [sample, setSample] = useState<SampleState | null>(readSample)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const save = (value: SampleState) => {
    try { localStorage.setItem(KEY, JSON.stringify(value)) } catch { /* Keep this tab usable when storage is unavailable. */ }
    setSample(value)
  }

  useEffect(() => {
    if (!sample?.done) return
    let active = true
    knowledgeApi.getKnowledgeBaseMetadata(sample.kbId).catch(reason => {
      if (active && reason?.response?.status === 404) {
        try { localStorage.removeItem(KEY) } catch { /* best effort */ }
        setSample(null)
      }
    })
    return () => { active = false }
  }, [sample?.kbId, sample?.done])

  useEffect(() => {
    if (!sample?.taskId || sample.done) return
    let active = true
    let timer: ReturnType<typeof setTimeout>
    const check = async () => {
      try {
        const progress = await knowledgeApi.getUploadProgress(sample.taskId!)
        if (!active) return
        setError('')
        setMessage(progress.message || '正在解析和索引示例文档…')
        if (progress.status === 'completed') { save({ ...sample, done: true }); setMessage('示例文档已就绪。'); return }
        if (progress.status === 'failed') { setError(progress.error || '索引未完成，请检查连接后重试。'); save({ kbId: sample.kbId }); return }
      } catch (reason: any) {
        if (!active) return
        if (reason?.response?.status === 404) {
          save({ kbId: sample.kbId })
          setError('原处理任务已失效。请重试，已完成的示例会直接复用。')
          return
        } else setError('暂时无法读取示例进度。恢复连接后将继续检查。')
      }
      if (active) timer = setTimeout(check, 2500)
    }
    void check()
    return () => { active = false; clearTimeout(timer) }
  }, [sample?.kbId, sample?.taskId, sample?.done])

  const importSample = async () => {
    setBusy(true); setError('')
    try {
      let kbId = sample?.kbId
      if (kbId) {
        try { await knowledgeApi.getKnowledgeBaseMetadata(kbId) }
        catch (reason: any) { if (reason?.response?.status === 404) kbId = undefined; else throw reason }
      }
      if (!kbId) {
        const result = await knowledgeApi.createKnowledgeBase({ name: 'Tessmora 入门示例', description: '一份合成回滚手册，用于体验检索与引用。' })
        kbId = result.id as string
        save({ kbId })
      }
      const existing = (await knowledgeApi.getKnowledgeBaseFiles(kbId)).files.find(file => file.name === '回滚运行手册.md')
      if (existing && (!existing.status || existing.status === 'completed')) {
        save({ kbId, done: true }); setMessage('已有示例文档已就绪。'); return
      }
      if (existing?.processing_id && ['queued', 'processing', 'running'].includes(existing.status || '')) {
        save({ kbId, taskId: existing.processing_id }); return
      }
      const result = await knowledgeApi.startBatchUpload(kbId, [new File([document], '回滚运行手册.md', { type: 'text/markdown' })])
      const taskId = result.results[0]?.processing_id
      if (!taskId) throw new Error(result.results[0]?.error || '示例未能加入索引队列，请重试。')
      save({ kbId, taskId }); setMessage('示例已提交，正在建立索引…')
    } catch (reason) { setError(reason instanceof Error ? reason.message : '导入未完成，请重试。') }
    finally { setBusy(false) }
  }

  return <section className="setup-sample">
    <div className="setup-sample-title"><FileText size={21} /><h3>{t('试一份小文档')}</h3><span>{t('可选')}</span></div>
    <p>{t('导入一份回滚手册，用下面的问题试试回答，再点击引用查看原文。')}</p>
    <blockquote>{question}</blockquote>
    {sample?.done ? <div className="setup-sample-controls"><Link className="setup-button" to={`/knowledge/${sample.kbId}`}>{t('打开示例知识库')}</Link><button className="setup-button" onClick={async () => { try { await navigator.clipboard.writeText(question); setCopied(true) } catch { setError('请直接选中并复制上方问题。') } }}><Copy size={15} />{copied ? t('已复制问题') : t('复制问题')}</button></div>
      : <button className="setup-button" disabled={busy || Boolean(sample?.taskId)} onClick={importSample}>{busy || sample?.taskId ? <Loader2 size={16} className="setup-spin" /> : <FileText size={16} />}{sample?.taskId ? t('正在索引…') : error ? t('重试导入示例') : t('导入示例文档')}</button>}
    {message && <p className="setup-live" role="status">{sample?.done && <CheckCircle2 size={16} />}{t(message)}</p>}
    {error && <p className="setup-error" role="alert">{t(error)}</p>}
  </section>
}
