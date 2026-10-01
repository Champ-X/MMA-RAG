import { useId, useState } from 'react'
import { ArrowDown, ArrowRight, AudioLines, Bot, Check, FileText, Image, Layers3, Quote, Search, Video } from 'lucide-react'

const sources = [
  { id: 'document', icon: FileText, title: '文档', detail: '结构与段落', locator: '页码 / 段落', evidence: '文档语义', description: '保留章节、表格与段落结构，让检索结果可以回到原文。' },
  { id: 'image', icon: Image, title: '图片', detail: '描述与视觉', locator: '原图 / 描述', evidence: '视觉语义', description: '图像描述与视觉向量互补检索，回答可以关联原始图片。' },
  { id: 'audio', icon: AudioLines, title: '音频', detail: '转写与声学', locator: '原音频 / 转写', evidence: '转写与声学线索', description: '转写内容与声学向量保留两种线索，检索结果关联原音频。' },
  { id: 'video', icon: Video, title: '视频', detail: '场景与镜头', locator: '镜头 / 时间范围', evidence: '镜头语义', description: '场景、镜头与关键帧组织视频语义，来源保留可回看的时间范围。' },
] as const

/** This atlas explains the architecture without sending model or retrieval requests. */
export function EvidenceCircuit() {
  const [mode, setMode] = useState<'direct' | 'agent'>('direct')
  const [sourceId, setSourceId] = useState<(typeof sources)[number]['id']>('document')
  const descriptionId = useId()
  const selectedSource = sources.find((source) => source.id === sourceId) ?? sources[0]
  const SourceIcon = selectedSource.icon
  const isAgent = mode === 'agent'

  return (
    <figure className="evidence-circuit" data-mode={mode} data-source={sourceId}>
      <figcaption className="circuit-heading">
        <div><Layers3 size={19} aria-hidden="true" /><span>证据连接图<small>选择一种素材，沿着它的路径看下去</small></span></div>
        <div className="circuit-mode-switch" role="group" aria-label="架构示意检索路径">
          <button type="button" aria-pressed={!isAgent} onClick={() => setMode('direct')}><Search size={16} aria-hidden="true" />Direct<span>直接检索</span></button>
          <button type="button" aria-pressed={isAgent} onClick={() => setMode('agent')}><Bot size={16} aria-hidden="true" />Agent<span>按需深研</span></button>
        </div>
      </figcaption>
      <div className="circuit-map">
        <div className="circuit-sources" role="group" aria-label="探索素材模态">
          <p className="circuit-column-label">素材 · Sources</p>
          {sources.map(({ id, icon: Icon, title, detail }) => (
            <button type="button" className="circuit-source" data-source={id} aria-pressed={id === sourceId} aria-describedby={id === sourceId ? descriptionId : undefined} onClick={() => setSourceId(id)} key={id}>
              <span className="circuit-source-icon"><Icon size={20} aria-hidden="true" /></span><span><strong>{title}</strong><small>{detail}</small></span>
              <ArrowRight size={15} className="circuit-source-arrow" aria-hidden="true" />
            </button>
          ))}
        </div>
        <div className="circuit-collector" aria-hidden="true"><span /><span /><span /><span /><i /><ArrowRight size={16} /></div>
        <div className="circuit-core-wrap">
          <div className="circuit-query"><Search size={15} aria-hidden="true" /><span>问题 + 上下文 + 范围</span><ArrowDown size={15} aria-hidden="true" /></div>
          <div className="circuit-core">
            <div className="circuit-core-heading"><span className="circuit-core-symbol"><Layers3 size={24} aria-hidden="true" /></span><div><span className="circuit-node-eyebrow">共享检索底座</span><strong>Retrieval Core</strong></div></div>
            <div className="circuit-core-stages"><span>理解与路由</span><ArrowRight size={13} aria-hidden="true" /><span>按需召回</span><ArrowRight size={13} aria-hidden="true" /><span>融合精排</span></div>
            <div className="circuit-recall-lanes"><span>Dense</span><span>Sparse</span><span>Visual</span><span>Audio</span><span>Video</span></div>
            <div className="circuit-mode-indicator">{isAgent ? <Bot size={16} aria-hidden="true" /> : <Check size={16} aria-hidden="true" />}<span>{isAgent ? '原问题取证 → 规划补查 → 合并证据' : '一次检索，汇集相关证据'}</span></div>
          </div>
          <div className="circuit-loop" data-active={isAgent} aria-hidden="true"><span>共享底座，按预算补查</span><span>↻</span></div>
        </div>
        <div className="circuit-output-link" aria-hidden="true"><span /><ArrowRight size={18} /></div>
        <div className="circuit-output">
          <p className="circuit-column-label">交付 · Answer with sources</p>
          <div className="circuit-evidence"><div><SourceIcon size={16} aria-hidden="true" /><strong>{selectedSource.evidence}</strong><span>[1]</span></div><p>{selectedSource.locator}<span>保留来源定位</span></p></div>
          <div className="circuit-evidence circuit-evidence-secondary"><div><Layers3 size={16} aria-hidden="true" /><strong>统一证据</strong><span>[2]</span></div><p>RetrievalResult<span>引用映射</span></p></div>
          <ArrowDown size={16} className="circuit-down" aria-hidden="true" />
          <div className="circuit-answer"><Quote size={19} aria-hidden="true" /><div><strong>有来源的回答</strong><span>从回答，回到每一份素材。<b>[1]</b> <b>[2]</b></span></div></div>
        </div>
      </div>
      <div className="circuit-explanation" id={descriptionId} aria-live="polite" aria-atomic="true">
        <p><SourceIcon size={16} aria-hidden="true" /><strong>{selectedSource.title}</strong><span>{selectedSource.description}</span></p>
        <span className="circuit-path-note"><span className="circuit-legend-dot" />{isAgent ? 'Agent 在预算内继续补查' : 'Direct 完成一次检索'}</span>
      </div>
    </figure>
  )
}
