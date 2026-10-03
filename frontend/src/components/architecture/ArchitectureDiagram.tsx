import { useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { ArrowRight, Bot, Braces, Check, Database, Download, Expand, FileInput, HardDrive, Layers3, MessageSquare, Search, Sparkles, Terminal, Waypoints, X } from 'lucide-react'
import { ConnectorLayer, type ConnectionSpec } from './ConnectorLayer'
import './architectureDiagram.css'

const architectureImage = '/architecture/tessmora-system-architecture.png'
const domains = [
  { id: 'R', title: '共享检索', name: 'Retrieval Core', icon: Search, tone: 'retrieval', summary: '把问题转成排序后的证据。', items: ['理解意图，改写检索表达', '按范围与画像选择知识库', '按需召回各模态内容', '融合候选，再按问题精排'], note: 'Direct 做单次检索编排；Agent 补查复用同一底座，不重复完整的意图与改写。', boundary: '闲聊可跳过检索；检索结果通过 RetrievalResult 保留内容、来源与媒体定位。' },
  { id: 'A', title: '有界深研', name: 'Agent Runtime', icon: Bot, tone: 'agent', summary: '规划补查，让证据逐步收敛。', items: ['先检索原问题，建立锚点', '规划互补子查询', '调用只读检索工具', '证据去重，并按规则停止'], note: '在共享检索之上增加规划与观察。每次补查都保留原始范围约束。', boundary: '证据充分、无新增证据或预算耗尽时，结束补查。' },
  { id: 'G', title: '生成交付', name: 'Generation', icon: Sparkles, tone: 'generation', summary: '用可回溯的证据组织回答。', items: ['按模态与长度预算组装材料', '建立引用编号与来源映射', '按任务选择生成模型', '按正文显式引用收敛来源'], note: '接收已排序的检索结果，再组织上下文、生成回答，并保留来源映射。', boundary: 'Web 以 SSE 交付；其他接入端使用各自的消息适配器。' },
  { id: 'K', title: '知识准备', name: 'Knowledge & Ingestion', icon: FileInput, tone: 'knowledge', summary: '让原始素材成为可检索的知识。', items: ['按文档、图像、音频与视频解析', '组织可定位的语义单元', '写入对象与多模态索引', '构建知识库画像，辅助路由'], note: '在问答之前完成素材理解与索引构建。它为在线检索提供数据支撑。', boundary: '保留原始素材及来源定位，回答时可回到原文或媒体。' },
]
const accessPoints = [
  { title: 'Web', description: '交互与流式回答', icon: MessageSquare },
  { title: 'Skill / CLI', description: '自动化工具调用', icon: Terminal },
  { title: '飞书', description: '消息接入与送达', icon: Waypoints },
  { title: 'Retrieval API', description: '直接获取检索证据', icon: Braces },
]

function DomainNode({ domain, selected, onSelect, detailId }: { domain: typeof domains[number]; selected: boolean; onSelect: (id: string) => void; detailId: string }) {
  const Icon = domain.icon
  return (
    <button type="button" className={`diagram-node diagram-tone-${domain.tone}`} data-selected={selected} data-connection-node={`system-${domain.id}`} aria-pressed={selected} aria-controls={detailId} onClick={() => onSelect(domain.id)}>
      <span className="diagram-node-topline"><span className="diagram-node-icon"><Icon size={23} strokeWidth={1.65} aria-hidden="true" /></span><span className="diagram-node-indicator" aria-hidden="true">{selected ? <Check size={15} /> : <ArrowRight size={15} />}</span></span>
      <span className="diagram-node-title">{domain.title}</span>
      <span className="diagram-node-name" lang="en">{domain.name}</span>
      <span className="diagram-node-summary">{domain.summary}</span>
    </button>
  )
}

export function ArchitectureDiagram() {
  const [selectedId, setSelectedId] = useState('R')
  const [compactConnections, setCompactConnections] = useState(false)
  const figureRef = useRef<HTMLElement>(null)

  useLayoutEffect(() => {
    const figure = figureRef.current
    if (!figure) return
    const syncLayout = () => setCompactConnections(figure.getBoundingClientRect().width <= 702)
    syncLayout()
    const observer = new ResizeObserver(syncLayout)
    observer.observe(figure)
    return () => observer.disconnect()
  }, [])

  const connections = useMemo<ConnectionSpec[]>(() => [
    { id: 'system-agent-retrieval', from: 'system-A', to: 'system-R', tone: 'teal', endTone: 'accent', label: '检索调用', bidirectional: true },
    { id: 'system-retrieval-generation', from: 'system-R', to: 'system-G', tone: 'accent', endTone: 'amber', label: '排序证据' },
    { id: 'system-direct-retrieval', from: 'system-direct', to: 'system-R', tone: 'accent', fromAnchor: compactConnections ? 'right' : 'bottom', toAnchor: compactConnections ? 'right' : 'top', via: compactConnections ? 'right' : undefined, viaInset: compactConnections ? 6 : undefined },
    { id: 'system-knowledge-retrieval', from: 'system-K', to: 'system-R', tone: 'blue', dashed: true, fromAnchor: compactConnections ? 'left' : 'top', toAnchor: compactConnections ? 'left' : 'bottom', via: compactConnections ? 'left' : undefined },
  ], [compactConnections])
  const detailId = useId()
  const headingId = useId()
  const selected = domains.find(domain => domain.id === selectedId) ?? domains[0]
  const SelectedIcon = selected.icon
  const node = (id: string) => <DomainNode domain={domains.find(domain => domain.id === id)!} selected={selectedId === id} onSelect={setSelectedId} detailId={detailId} />

  return (
    <section id="system-architecture" className="scroll-mt-24">
      <div className="atlas-section-intro">
        <div><p className="atlas-eyebrow">SYSTEM ATLAS / 整体架构</p><h2>围绕证据，分工协作</h2></div>
        <p>先看在线问答如何取证，再看知识与模型如何支撑它。选择模块，展开职责与边界。</p>
      </div>
      <Dialog.Root>
        <figure ref={figureRef} className="diagram-atlas">
          <figcaption className="diagram-toolbar">
            <div className="diagram-toolbar-title"><Layers3 size={19} aria-hidden="true" /><strong>系统协作图</strong><span>调用关系与能力支撑</span></div>
            <div className="diagram-toolbar-actions">
              <a href={architectureImage} download="tessmora-system-architecture.png"><Download size={15} aria-hidden="true" />下载原图</a>
              <Dialog.Trigger asChild><button type="button"><Expand size={15} aria-hidden="true" />查看原图</button></Dialog.Trigger>
            </div>
          </figcaption>
          <div className="diagram-reading-guide"><span><i className="diagram-guide-line" aria-hidden="true" />调用与证据传递</span><span><i className="diagram-guide-line is-dashed" aria-hidden="true" />索引与知识支撑</span></div>
          <div className="diagram-workspace">
            <div className="diagram-map">
              <div className="diagram-access-band">
                <div className="diagram-access-heading"><span>从这些入口进入</span><small>接入层</small></div>
                <div className="diagram-access">
                  {accessPoints.map(({ title, description, icon: Icon }) => <div key={title}><Icon size={18} strokeWidth={1.6} aria-hidden="true" /><div><strong>{title}</strong><span>{description}</span></div></div>)}
                </div>
              </div>
              <p className="diagram-request-link"><span aria-hidden="true" />问答请求进入取证路径</p>
              <div className="diagram-topology" role="group" aria-label="领域模块，选择查看职责">
                <ConnectorLayer connections={connections} />
                <div className="diagram-direct-entry"><span data-connection-node="system-direct">Direct · 单次编排</span></div>
                <div className="diagram-evidence-path">
                  {node('A')}
                  {node('R')}
                  {node('G')}
                </div>
                <div className="diagram-knowledge-branch">
                  <p className="diagram-support-caption"><span>索引与画像</span><span>支撑共享检索</span></p>
                  {node('K')}
                </div>
                <p className="diagram-map-note"><span aria-hidden="true" />知识准备在入库时进行，不是每次问答的前置调用。</p>
              </div>
            </div>
            <aside id={detailId} className={`diagram-detail diagram-tone-${selected.tone}`} aria-labelledby={headingId}>
              <div className="diagram-detail-label"><span>正在阅读</span><span aria-hidden="true">{selected.id}</span></div>
              <span className="diagram-detail-icon"><SelectedIcon size={27} strokeWidth={1.6} aria-hidden="true" /></span>
              <h3 id={headingId} aria-live="polite">{selected.title}</h3>
              <p className="diagram-detail-name" lang="en">{selected.name}</p>
              <p className="diagram-detail-statement">{selected.note}</p>
              <ul className="diagram-responsibilities">{selected.items.map(item => <li key={item}><Check size={15} aria-hidden="true" /><span>{item}</span></li>)}</ul>
              <p className="diagram-detail-boundary"><span>职责边界</span>{selected.boundary}</p>
            </aside>
          </div>
          <div className="diagram-foundation">
            <div className="diagram-foundation-heading"><span>共享能力</span><p>为多个模块提供支撑</p></div>
            <div className="diagram-foundation-item"><Database size={22} strokeWidth={1.6} aria-hidden="true" /><div><strong>Qdrant</strong><span>语义、稀疏与专用向量索引</span></div></div>
            <div className="diagram-foundation-item"><HardDrive size={22} strokeWidth={1.6} aria-hidden="true" /><div><strong>MinIO</strong><span>原始素材与媒体对象</span></div></div>
            <div className="diagram-foundation-item"><Braces size={22} strokeWidth={1.6} aria-hidden="true" /><div><strong>LLM Manager</strong><span>按任务选择模型与提供商</span></div></div>
          </div>
          <p className="diagram-caption">图中展示问答主路径；Retrieval API 也可直接返回证据。Redis / Celery 是可选的异步任务设施。</p>
        </figure>
        <Dialog.Portal>
          <Dialog.Overlay className="diagram-modal-overlay" />
          <Dialog.Content className="diagram-modal-content">
            <Dialog.Title className="sr-only">Tessmora 系统架构原图</Dialog.Title>
            <Dialog.Description className="sr-only">完整分层架构插图，可以滚动查看，按 Escape 关闭。</Dialog.Description>
            <div className="diagram-modal-image"><img src={architectureImage} alt="Tessmora 多模态 Agentic Retrieval 原始系统架构图" /></div>
            <Dialog.Close asChild><button type="button" aria-label="关闭架构原图" className="diagram-modal-close"><X size={22} aria-hidden="true" /></button></Dialog.Close>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </section>
  )
}
