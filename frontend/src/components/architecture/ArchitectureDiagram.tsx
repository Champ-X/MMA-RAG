import { useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { ArrowDown, ArrowRight, ArrowUpDown, Bot, Braces, Check, Database, Download, Expand, FileInput, HardDrive, Layers3, MessageSquare, Search, ServerCog, Sparkles, Terminal, Waypoints, X } from 'lucide-react'
import './architectureDiagram.css'

const architectureImage = '/architecture/tessmora-system-architecture.png'
const domains = [
  { id: 'R', title: '共享检索', name: 'Retrieval Core', icon: Search, tone: 'retrieval', summary: '按需召回、融合与精排，形成可用证据。', items: ['意图识别与查询改写', '知识库画像路由', '五路按需召回', 'RRF 融合与精排'], note: 'Direct 与 Agent 共享同一检索底座。' },
  { id: 'A', title: '有界深研', name: 'Agent Runtime', icon: Bot, tone: 'agent', summary: '从原问题锚点出发，规划互补查询与补查。', items: ['原问题检索锚点', '规划互补子查询', '只读检索工具', '证据账本与停止规则'], note: '补查复用 Retrieval Core，并按证据与预算停止。' },
  { id: 'G', title: '生成与交付', name: 'Generation', icon: Sparkles, tone: 'generation', summary: '将已排序的证据，转为带来源的流式回答。', items: ['多模态上下文预算', '来源与编号映射', '模型路由与生成', 'SSE 流式回答'], note: '消费已排序、可引用的证据，保留来源映射。' },
  { id: 'K', title: '知识与入库', name: 'Knowledge & Ingestion', icon: FileInput, tone: 'knowledge', summary: '理解原始素材，构建语义索引与知识库画像。', items: ['各模态原生解析', '结构化语义切分', '多模态向量编码', '索引与知识库画像'], note: '入库构建检索索引，并保留可回溯的原始素材。' },
]
const accessPoints = [
  { title: 'Web / SSE', description: '交互与流式回答', icon: MessageSquare },
  { title: 'Skill / CLI', description: '自动化与工具调用', icon: Terminal },
  { title: '飞书 / WSS', description: '检索与消息送达', icon: Waypoints },
  { title: 'Retrieval API', description: '检索能力集成', icon: Braces },
]

function DomainNode({ domain, selected, onSelect }: { domain: typeof domains[number]; selected: boolean; onSelect: (id: string) => void }) {
  const Icon = domain.icon
  return (
    <div className={`diagram-node diagram-tone-${domain.tone}`} data-selected={selected}>
      <h3>
        <button type="button" className="diagram-node-button" aria-pressed={selected} aria-controls="diagram-module-detail" onClick={() => onSelect(domain.id)}>
          <span className="diagram-node-icon"><Icon size={23} strokeWidth={1.7} aria-hidden="true" /></span>
          <span className="diagram-node-title">{domain.title}</span>
          <span className="diagram-node-indicator" aria-hidden="true">{selected ? <Check size={15} /> : <ArrowRight size={15} />}</span>
        </button>
      </h3>
      <p className="diagram-node-name" lang="en">{domain.name}</p>
      <p className="diagram-node-summary">{domain.summary}</p>
    </div>
  )
}

export function ArchitectureDiagram() {
  const [selectedId, setSelectedId] = useState('R')
  const selected = domains.find(domain => domain.id === selectedId) ?? domains[0]
  const findDomain = (id: string) => domains.find(domain => domain.id === id)!

  return (
    <section id="system-architecture" className="scroll-mt-24">
      <div className="atlas-section-intro">
        <div><p className="atlas-eyebrow">SYSTEM ATLAS / 整体架构</p><h2>从请求入口，到证据交付</h2></div>
        <p>接入层承接请求，领域模块围绕证据协作。数据与模型能力作为共享底座，支持理解、检索与生成。</p>
      </div>
      <Dialog.Root>
        <figure className="diagram-atlas">
          <figcaption className="diagram-toolbar">
            <div className="diagram-toolbar-title"><span className="diagram-toolbar-icon"><Layers3 size={20} aria-hidden="true" /></span><div><strong>Tessmora 系统架构</strong><span>入口 · 领域协作 · 共享底座</span></div></div>
            <div className="diagram-toolbar-actions">
              <a href={architectureImage} download="tessmora-system-architecture.png"><Download size={16} aria-hidden="true" />下载原图</a>
              <Dialog.Trigger asChild><button type="button"><Expand size={16} aria-hidden="true" />放大原图</button></Dialog.Trigger>
            </div>
          </figcaption>
          <div className="diagram-body">
            <div className="diagram-layer diagram-access-layer">
              <div className="diagram-layer-label"><span>接入层</span><small lang="en">ACCESS</small></div>
              <div className="diagram-access">
                {accessPoints.map(({ title, description, icon: Icon }) => <div key={title}><Icon size={19} strokeWidth={1.7} aria-hidden="true" /><div><strong>{title}</strong><span>{description}</span></div></div>)}
              </div>
            </div>
            <div className="diagram-request-link"><span className="diagram-request-line" aria-hidden="true" /><ArrowDown size={17} aria-hidden="true" /><span>请求与执行策略</span></div>
            <div className="diagram-layer diagram-domain-layer">
              <div className="diagram-layer-label"><span>领域层</span><small lang="en">DOMAINS</small></div>
              <div>
                <div className="diagram-topology" role="group" aria-label="领域模块，选择查看职责">
                  <div className="diagram-agent-branch">
                    <div className="diagram-path-note"><Bot size={17} aria-hidden="true" /><span><strong>Agent 路径</strong>按需规划与补查</span></div>
                    <DomainNode domain={findDomain('A')} selected={selectedId === 'A'} onSelect={setSelectedId} />
                    <div className="diagram-path-note diagram-direct-note"><Search size={17} aria-hidden="true" /><span><strong>Direct 路径</strong>直接复用检索底座</span></div>
                  </div>
                  <div className="diagram-agent-link" aria-hidden="true"><ArrowUpDown size={18} /><span>检索锚点 / 按需补查</span></div>
                  <div className="diagram-evidence-path">
                    <DomainNode domain={findDomain('K')} selected={selectedId === 'K'} onSelect={setSelectedId} />
                    <div className="diagram-horizontal-link"><span>构建索引</span><ArrowRight size={19} aria-hidden="true" /></div>
                    <DomainNode domain={findDomain('R')} selected={selectedId === 'R'} onSelect={setSelectedId} />
                    <div className="diagram-horizontal-link"><span>交付证据</span><ArrowRight size={19} aria-hidden="true" /></div>
                    <DomainNode domain={findDomain('G')} selected={selectedId === 'G'} onSelect={setSelectedId} />
                  </div>
                </div>
                <div id="diagram-module-detail" className={`diagram-detail diagram-tone-${selected.tone}`}>
                  <div className="diagram-detail-heading"><span className="diagram-detail-marker" aria-hidden="true" /><h3>{selected.title}<span>模块职责</span></h3><span className="diagram-detail-status" role="status" aria-live="polite">{selected.name}</span></div>
                  <ul className="diagram-responsibilities" role="list">{selected.items.map(item => <li key={item}><Check size={14} aria-hidden="true" />{item}</li>)}</ul>
                  <p>{selected.note}</p>
                </div>
              </div>
            </div>
            <div className="diagram-foundation-link"><span aria-hidden="true" /><p>共享对象、索引与模型能力</p><span aria-hidden="true" /></div>
            <div className="diagram-layer diagram-foundation-layer">
              <div className="diagram-layer-label"><span>共享底座</span><small lang="en">FOUNDATION</small></div>
              <div className="diagram-foundation">
                <div className="diagram-data-plane">
                  <h3><Database size={16} aria-hidden="true" />数据面</h3>
                  <div className="diagram-storage">
                    <div><Database size={23} strokeWidth={1.6} aria-hidden="true" /><div><strong>Qdrant</strong><span>语义、稀疏与专用向量索引</span></div></div>
                    <div><HardDrive size={23} strokeWidth={1.6} aria-hidden="true" /><div><strong>MinIO</strong><span>原始素材与媒体对象</span></div></div>
                    <div><ServerCog size={23} strokeWidth={1.6} aria-hidden="true" /><div><strong>Redis / Celery <em>可选</em></strong><span>异步任务与控制面</span></div></div>
                  </div>
                </div>
                <div className="diagram-model-plane">
                  <h3><Braces size={16} aria-hidden="true" />模型面</h3>
                  <div className="diagram-model-manager"><span className="diagram-model-icon"><Braces size={24} strokeWidth={1.6} aria-hidden="true" /></span><div><strong>LLM Manager</strong><span>按任务选择模型与提供商</span></div></div>
                  <p className="diagram-model-tasks"><span>入库理解</span><span>向量与精排</span><span>回答生成</span></p>
                </div>
              </div>
            </div>
          </div>
          <p className="diagram-caption"><span aria-hidden="true" />知识入库构建索引，Direct 与 Agent 共用检索，生成模块消费证据。Redis / Celery 不参与在线证据合同。</p>
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
