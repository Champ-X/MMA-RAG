import { useState } from 'react'
import { ArrowDown, ArrowRight, AudioLines, Bot, Check, FileText, Image, Quote, Search, Video } from 'lucide-react'

const sources = [
  { icon: FileText, title: '文档', detail: '结构与段落', className: 'document' },
  { icon: Image, title: '图片', detail: '视觉语义', className: 'image' },
  { icon: AudioLines, title: '音频', detail: '转写与声学', className: 'audio' },
  { icon: Video, title: '视频', detail: '场景与镜头', className: 'video' },
]

/** Explanatory only: mode selection never makes a model or retrieval call. */
export function EvidenceCircuit() {
  const [mode, setMode] = useState<'direct' | 'agent'>('direct')
  const isAgent = mode === 'agent'
  return (
    <figure className="evidence-circuit" data-mode={mode}>
      <figcaption className="circuit-heading"><span>证据如何流动</span><span className="circuit-caption">架构示意</span></figcaption>
      <div className="circuit-mode-switch" role="group" aria-label="架构示意检索路径">
        <button type="button" aria-pressed={!isAgent} onClick={() => setMode('direct')}><Search size={14} aria-hidden="true" />Direct<span>一次检索</span></button>
        <button type="button" aria-pressed={isAgent} onClick={() => setMode('agent')}><Bot size={14} aria-hidden="true" />Agent<span>有界深研</span></button>
      </div>
      <div className="circuit-map">
        <div className="circuit-sources">{sources.map(({ icon: Icon, title, detail, className }) => (
          <div className={`circuit-source circuit-source-${className}`} key={title}><Icon size={17} aria-hidden="true" /><div><strong>{title}</strong><span>{detail}</span></div></div>
        ))}</div>
        <div className="circuit-collector" aria-hidden="true"><span /><span /><span /><span /><i /></div>
        <div className="circuit-core">
          <div className="circuit-core-symbol"><Search size={24} strokeWidth={1.6} aria-hidden="true" /></div>
          <span className="circuit-node-eyebrow">共享检索底座</span><strong>Retrieval Core</strong><p>画像路由 · 多路召回<br />融合排序 · 精排</p>
          <div className="circuit-mode-indicator">{isAgent ? <Bot size={13} aria-hidden="true" /> : <Check size={13} aria-hidden="true" />}{isAgent ? '规划 → 检索 → 观察' : '一次检索，完成取证'}</div>
          {isAgent && <div className="circuit-loop" aria-hidden="true"><span>按需补查 ↻</span></div>}
        </div>
        <div className="circuit-output-link" aria-hidden="true"><ArrowRight size={15} /></div>
        <div className="circuit-output">
          <div className="circuit-evidence"><span className="circuit-node-eyebrow">统一证据</span><div className="circuit-evidence-lines" aria-hidden="true"><i /><i /><i /></div><strong>RetrievalResult</strong></div>
          <ArrowDown size={15} className="circuit-down" aria-hidden="true" />
          <div className="circuit-answer"><Quote size={16} aria-hidden="true" /><strong>有来源的回答</strong><span>回答 <b>[1]</b> <b>[2]</b></span></div>
        </div>
      </div>
      <div className="circuit-explanation" aria-live="polite" aria-atomic="true"><span className="circuit-legend-dot" /><p>{isAgent ? '复杂问题按预算补充检索，所有轮次复用同一检索底座。' : '简单问题一次取证，检索结果直接进入引用与生成。'}</p></div>
    </figure>
  )
}
