import { useEffect, useId, useRef, useState } from 'react'
import { ArrowLeft, ArrowUpRight, FileText, Video } from 'lucide-react'
import './bookExplorers.css'

type BookText = (zh: string, en: string) => string
type BookProps = { text: BookText }
type Source = 'lecture' | 'video'

export function BookEvidence({ text }: BookProps) {
  const [source, setSource] = useState<Source | null>(null)
  const panelRef = useRef<HTMLElement>(null)
  const citationRefs = useRef<Partial<Record<Source, HTMLButtonElement | null>>>({})
  const id = useId()
  const sourceId = `${id}-source`
  const sourceHeadingId = `${id}-heading`

  useEffect(() => {
    if (source) {
      panelRef.current?.focus({ preventScroll: true })
      panelRef.current?.scrollIntoView({ block: 'nearest' })
    }
  }, [source])

  const openSource = (next: Source) => {
    setSource(next)
    if (source === next) panelRef.current?.focus({ preventScroll: true })
  }

  const returnToCitation = () => {
    if (source) citationRefs.current[source]?.focus()
    setSource(null)
  }

  const citation = (kind: Source, label: string) => (
    <button
      type="button"
      className="book-citation"
      ref={element => { citationRefs.current[kind] = element }}
      aria-expanded={source === kind}
      aria-controls={sourceId}
      aria-label={text(`查看引用来源：${label}`, `Read citation source: ${label}`)}
      onClick={() => openSource(kind)}
    >{label}<ArrowUpRight size={12} aria-hidden="true" /></button>
  )

  return (
    <div className="book-evidence">
      <p className="book-evidence-disclaimer">{text('虚构示例 · 仅演示引用交互，不发起检索', 'Fictional example · citation interaction only; no live retrieval')}</p>
      <div className="book-evidence-answer">
        <p>{text('贝叶斯更新，是在获得新证据后调整原先的判断。', 'Bayesian updating revises an earlier belief in light of new evidence.')} {citation('lecture', text('讲义 p.12', 'Notes p.12'))}</p>
        <p>{text('可以把它理解为：以先验为起点，结合新证据，得到更新后的后验。', 'Think of a prior as the starting point: incorporate new evidence to arrive at an updated posterior.')} {citation('video', text('视频 02:18', 'Video 02:18'))}</p>
      </div>
      <div className="book-source-space">
        {source ? (
          <section className="book-source-panel" id={sourceId} ref={panelRef} tabIndex={-1} aria-labelledby={sourceHeadingId}>
            <div className="book-source-heading">
              {source === 'lecture' ? <FileText size={19} strokeWidth={1.5} aria-hidden="true" /> : <Video size={19} strokeWidth={1.5} aria-hidden="true" />}
              <h3 id={sourceHeadingId}>{source === 'lecture' ? text('讲义原文 · 第 12 页', 'Lecture notes · page 12') : text('视频转写 · 02:18—02:42', 'Video transcript · 02:18–02:42')}</h3>
              <span>{text('虚构来源', 'Fictional source')}</span>
            </div>
            <blockquote>{source === 'lecture'
              ? text('“贝叶斯更新将先验概率与新观测的似然结合，归一化后得到后验概率。”', '“Bayesian updating combines a prior probability with the likelihood of a new observation, then normalizes the result to obtain a posterior.”')
              : text('“我们先有一个初始判断；获得新的证据后，再更新这个判断。这个更新后的分布，就是后验。”', '“We begin with an initial belief, then update it when new evidence arrives. The updated distribution is the posterior.”')}
            </blockquote>
            <p className="book-source-context">{source === 'lecture'
              ? text('证据类型：原文片段。页码帮助找到位置，理解时仍需阅读前后文。', 'Evidence type: text passage. A page number locates it; surrounding context still matters.')
              : text('证据类型：语音转写。这个片段说明说了什么，不代表已核验视频中的全部画面。', 'Evidence type: speech transcript. It records what was said, without verifying every visual detail.')}
            </p>
            <button type="button" className="book-source-return" onClick={returnToCitation}><ArrowLeft size={15} aria-hidden="true" />{text('返回文中引用', 'Return to the citation')}</button>
          </section>
        ) : (
          <p className="book-source-invitation" id={sourceId}><ArrowUpRight size={19} strokeWidth={1.4} aria-hidden="true" />{text('点一下文中的引用，查看对应来源。', 'Select a citation above to view its source.')}</p>
        )}
      </div>
      <p className="book-evidence-footnote">{text('引用让依据可追溯，但不自动证明结论正确。来源是否支持这句话，仍需要逐项核对。', 'A citation makes evidence traceable; it does not automatically make a conclusion correct. Each claim still needs to be checked against its source.')}</p>
    </div>
  )
}
