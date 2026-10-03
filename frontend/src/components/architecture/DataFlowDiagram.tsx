import { Binary, Database, FileInput, Files, FolderSearch, GitBranch, HardDrive, Layers3, ListFilter, MessageSquare, RadioTower, ScanLine, ServerCog, UploadCloud } from 'lucide-react'
import { ConnectorLayer, FlowArrow } from './ConnectorLayer'
import { EvidenceConfluence } from './EvidenceConfluence'
import './architectureSections.css'

const flowLanes = [
  {
    id: 'ingestion', icon: UploadCloud, label: '写入路径', title: '先把素材理解好',
    description: '素材进入后完成解析与索引，保留原始对象，供后续问答重复使用。',
    outcome: '理解结果可复用',
    stages: [
      { icon: FileInput, title: '接入素材', detail: '文件上传、链接或外部文档' },
      { icon: ScanLine, title: '按模态解析', detail: '提取正文、画面、转写与镜头' },
      { icon: Files, title: '组织语义单元', detail: '文本块、图片、音频片段与视频镜头' },
      { icon: Binary, title: '构建索引', detail: '语义、稀疏与媒体专用向量' },
      { icon: Database, title: '保存产物', detail: '对象、来源记录与向量集合' },
    ],
  },
  {
    id: 'query', icon: RadioTower, label: '读取路径', title: '再为问题组织证据',
    description: '已入库素材通过现有索引参与检索；问答主链路无需重新解析原文件。',
    outcome: '回答与实际引用一起交付',
    stages: [
      { icon: FolderSearch, title: '确定范围', detail: '会话、知识库、文件与附件上下文' },
      { icon: GitBranch, title: '选择路径', detail: '直接检索，或按预算迭代取证' },
      { icon: ListFilter, title: '召回与排序', detail: '画像路由、混合检索与精排' },
      { icon: Layers3, title: '组装上下文', detail: '合并证据，建立来源编号映射' },
      { icon: MessageSquare, title: '生成与交付', detail: '流式回答，完成时收敛引用' },
    ],
  },
] as const

const sharedData = [
  { icon: HardDrive, title: 'MinIO', label: '保存对象与来源', detail: '原始文件 · 关键帧 · 解析记录', tone: 'teal' },
  { icon: Database, title: 'Qdrant', label: '保存证据与索引', detail: '文本 · 元数据 · 多模态向量', tone: 'purple' },
] as const

export function DataFlowDiagram() {
  return (
    <section id="data-flow" className="atlas-data-section scroll-mt-24">
      <div className="atlas-section-intro">
        <div><p className="atlas-section-kicker">数据流转 <span aria-hidden="true">/</span> Write once, retrieve often</p><h2>理解一次，供每一次提问使用</h2></div>
        <p>写入产出可复用的对象与索引；读取聚焦范围、相关性与引用。两条链路在共享数据层衔接。</p>
      </div>

      <div className="atlas-data-plane">
        <FlowLane lane={flowLanes[0]} />
        <div className="atlas-shared-data">
          <div className="atlas-shared-data-heading"><span /><p>共享数据层<small>素材留存 · 索引复用</small></p><span /></div>
          <div className="atlas-store-confluence">
            <EvidenceConfluence />
            <dl>{sharedData.map((item) => {
              const Icon = item.icon
              return <div className="atlas-store-node" data-confluence-source={item.tone} data-tone={item.tone} key={item.title}><dt><Icon size={25} strokeWidth={1.5} aria-hidden="true" /><span>{item.title}<small>{item.label}</small></span></dt><dd>{item.detail}</dd></div>
            })}</dl>
            <div className="atlas-data-bridge"><span className="atlas-confluence-junction" data-confluence-target aria-hidden="true" /><FlowArrow vertical /></div>
          </div>
          <p className="atlas-data-bridge-caption">检索读取索引，引用连接原始素材</p>
        </div>
        <FlowLane lane={flowLanes[1]} />
      </div>
      <aside className="atlas-async-note"><ServerCog size={19} strokeWidth={1.6} aria-hidden="true" /><div><strong>异步任务独立协作</strong><p>Redis / Celery 按配置承接队列、任务状态与长任务；它们负责处理进度，不承载检索证据。</p></div><span>控制面</span></aside>
    </section>
  )
}

function FlowLane({ lane }: { lane: (typeof flowLanes)[number] }) {
  const Icon = lane.icon
  return (
    <div className="atlas-flow-lane" data-lane={lane.id}>
      <div className="atlas-flow-lane-intro"><div className="atlas-flow-lane-title"><Icon size={24} strokeWidth={1.5} aria-hidden="true" /><div><p className="atlas-section-kicker">{lane.label}</p><h3>{lane.title}</h3></div></div><p>{lane.description}</p></div>
      <div className="atlas-flow-track">
        <ConnectorLayer connections={lane.stages.slice(1).map((_, index) => ({
          id: `${lane.id}-${index + 1}`,
          from: `${lane.id}-${index}`,
          to: `${lane.id}-${index + 1}`,
          tone: lane.id === 'ingestion' ? 'teal' as const : 'blue' as const,
        }))} />
        <ol className="atlas-flow-stages" aria-label={`${lane.label}阶段`} role="list">{lane.stages.map((stage, index) => {
          const StageIcon = stage.icon
          return <li key={stage.title}><div className="atlas-flow-stage-top"><span className="atlas-flow-stage-number" data-connection-node={`${lane.id}-${index}`} aria-hidden="true">{String(index + 1).padStart(2, '0')}</span></div><div className="atlas-flow-stage-copy"><StageIcon size={20} strokeWidth={1.6} aria-hidden="true" /><h4>{stage.title}</h4><p>{stage.detail}</p></div></li>
        })}</ol>
      </div>
      <div className="atlas-flow-outcome"><span /><p>{lane.outcome}<FlowArrow /></p></div>
    </div>
  )
}
