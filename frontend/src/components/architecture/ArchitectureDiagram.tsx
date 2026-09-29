import * as Dialog from '@radix-ui/react-dialog'
import { ArrowDown, Bot, Braces, Database, Download, Expand, FileInput, HardDrive, Layers3, Search, ServerCog, Sparkles, X } from 'lucide-react'

const architectureImage = '/architecture/tessmora-system-architecture.png'
const domains = [
  { id: 'R', title: '共享检索', name: 'Retrieval Core', icon: Search, tone: 'retrieval', items: ['One-Pass 意图理解', '知识库画像路由', '五路混合召回', 'RRF 融合与精排'], note: '一次调用，完成完整取证' },
  { id: 'A', title: '有界深研', name: 'Agent Runtime', icon: Bot, tone: 'agent', items: ['执行路径选择', '规划互补子查询', '只读检索工具', '证据账本与停止规则'], note: '复用 Retrieval Core 补查' },
  { id: 'G', title: '生成与交付', name: 'Generation', icon: Sparkles, tone: 'generation', items: ['多模态上下文预算', '来源与编号映射', '模型路由与生成', 'SSE 流式回答'], note: '消费已排序、可引用的证据' },
  { id: 'K', title: '知识与入库', name: 'Knowledge & Ingestion', icon: FileInput, tone: 'knowledge', items: ['各模态原生解析', '结构化语义切分', '多模态向量编码', '索引与知识库画像'], note: '让原始素材成为可检索语义' },
]

export function ArchitectureDiagram() {
  return (
    <section id="system-architecture" className="scroll-mt-24">
      <div className="atlas-section-intro">
        <div><p className="atlas-eyebrow">SYSTEM ATLAS / 整体架构</p><h2>从请求入口，到证据交付</h2></div>
        <p>接入层承接请求，领域模块各司其职。数据面保存对象与索引，模型面统一提供理解、检索与生成能力。</p>
      </div>
      <Dialog.Root>
        <figure className="system-blueprint">
          <figcaption className="blueprint-toolbar">
            <span><Layers3 size={16} aria-hidden="true" />Tessmora · 分层系统视图</span>
            <div>
              <a href={architectureImage} download="tessmora-system-architecture.png"><Download size={14} aria-hidden="true" />下载原图</a>
              <Dialog.Trigger asChild><button type="button"><Expand size={14} aria-hidden="true" />查看原图</button></Dialog.Trigger>
            </div>
          </figcaption>
          <div className="blueprint-body">
            <div className="blueprint-layer">
              <div className="blueprint-layer-label"><span>接入层</span><small>ACCESS</small></div>
              <div className="blueprint-access">
                <div><strong>Web / SSE</strong><span>交互与流式回答</span></div>
                <div><strong>Skill / CLI</strong><span>自动化与工具调用</span></div>
                <div><strong>飞书 / WSS</strong><span>直接检索与消息送达</span></div>
                <div><strong>Retrieval API</strong><span>检索能力集成</span></div>
              </div>
            </div>
            <div className="blueprint-bridge" aria-hidden="true"><ArrowDown size={16} /><span>请求与执行策略</span></div>
            <div className="blueprint-layer">
              <div className="blueprint-layer-label"><span>领域层</span><small>DOMAINS</small></div>
              <div className="blueprint-domains">
                {domains.map(({ id, title, name, icon: Icon, tone, items, note }) => (
                  <div className={`blueprint-domain blueprint-domain-${tone}`} key={id}>
                    <div className="blueprint-domain-heading"><Icon size={18} strokeWidth={1.6} aria-hidden="true" /><span>{id}</span></div>
                    <h3>{title}</h3><p className="blueprint-domain-name">{name}</p>
                    <ul role="list">{items.map(item => <li key={item}>{item}</li>)}</ul>
                    <p className="blueprint-domain-note">{note}</p>
                  </div>
                ))}
              </div>
            </div>
            <div className="blueprint-bridge" aria-hidden="true"><ArrowDown size={16} /><span>共享对象、索引与模型能力</span></div>
            <div className="blueprint-layer">
              <div className="blueprint-layer-label"><span>数据面</span><small>DATA</small></div>
              <div className="blueprint-storage">
                <div><Database size={18} aria-hidden="true" /><p><strong>Qdrant</strong><span>语义、稀疏与专用向量索引</span></p></div>
                <div><HardDrive size={18} aria-hidden="true" /><p><strong>MinIO</strong><span>原始素材与媒体对象</span></p></div>
                <div><ServerCog size={18} aria-hidden="true" /><p><strong>Redis / Celery <em>可选</em></strong><span>异步任务与控制面</span></p></div>
              </div>
            </div>
            <div className="blueprint-layer blueprint-model-layer">
              <div className="blueprint-layer-label"><span>模型面</span><small>MODELS</small></div>
              <div className="blueprint-models"><Braces size={19} aria-hidden="true" /><strong>LLM Manager</strong><span>按任务选择模型与提供商</span><div><span>入库理解</span><span>向量与精排</span><span>回答生成</span></div></div>
            </div>
          </div>
          <p className="blueprint-caption">Direct 与 Agent 共用检索底座；知识入库构建索引，生成模块消费证据。Redis / Celery 不参与在线证据合同。</p>
        </figure>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-[#06141c]/90 backdrop-blur-sm" />
          <Dialog.Content className="fixed inset-0 z-50 flex items-center justify-center p-3 focus:outline-none sm:p-6">
            <Dialog.Title className="sr-only">Tessmora 系统架构原图</Dialog.Title>
            <Dialog.Description className="sr-only">完整分层架构插图。小屏幕下可滚动查看，按 Escape 关闭。</Dialog.Description>
            <div className="max-h-[92dvh] max-w-[96vw] overflow-auto rounded-xl border border-white/15 bg-[#142631] p-2 shadow-2xl">
              <img src={architectureImage} alt="Tessmora 多模态 Agentic Retrieval 原始系统架构图" className="block h-auto min-w-[980px] max-w-none rounded-lg lg:min-w-0 lg:max-h-[88dvh] lg:max-w-[92vw]" />
            </div>
            <Dialog.Close asChild><button type="button" aria-label="关闭架构原图" className="fixed right-5 top-5 flex h-11 w-11 items-center justify-center rounded-full border border-white/30 bg-[#142631] text-white shadow-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white"><X size={20} aria-hidden="true" /></button></Dialog.Close>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </section>
  )
}
