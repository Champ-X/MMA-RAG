import { Database, HardDrive, RadioTower, ServerCog } from 'lucide-react'
import { dataFlowLanes } from '@/data/architectureData'
import './architectureSections.css'

const laneMeta = {
  ingestion: { icon: HardDrive, label: 'WRITE PATH / 写入' },
  query: { icon: RadioTower, label: 'READ PATH / 读取' },
}

const sharedData = [
  { icon: Database, title: 'Qdrant', detail: '语义、稀疏与专用向量；在线检索的主要读取面。' },
  { icon: HardDrive, title: 'MinIO', detail: '原始对象、关键帧、manifest 与预签名媒体 URL。' },
  { icon: ServerCog, title: 'Redis / Celery', detail: '可选任务控制面，不参与在线检索的证据约定。' },
]

export function DataFlowDiagram() {
  const ingestion = dataFlowLanes.find((lane) => lane.id === 'ingestion')
  const query = dataFlowLanes.find((lane) => lane.id === 'query')

  if (!ingestion || !query) return null

  return (
    <section id="data-flow" className="atlas-data-section scroll-mt-24">
      <div className="atlas-section-intro">
        <div>
          <p className="atlas-section-kicker">Data plane / 数据流转</p>
          <h2>离线理解素材，在线读取证据</h2>
        </div>
        <p>写入链路固化原始对象、解析模态并建立索引。问答时只读取、排序并组装引用，原文无需再次加工。</p>
      </div>

      <div className="atlas-data-plane">
        <FlowLane lane={ingestion} />
        <div className="atlas-shared-data">
          <p className="atlas-section-kicker">Shared data plane / 共享数据层</p>
          <dl>
            {sharedData.map((item) => {
              const Icon = item.icon
              return (
                <div key={item.title}>
                  <dt><Icon size={16} aria-hidden="true" />{item.title}</dt>
                  <dd>{item.detail}</dd>
                </div>
              )
            })}
          </dl>
        </div>
        <FlowLane lane={query} />
      </div>
    </section>
  )
}

function FlowLane({ lane }: { lane: (typeof dataFlowLanes)[number] }) {
  const meta = laneMeta[lane.id]
  const Icon = meta.icon

  return (
    <div className="atlas-flow-lane" data-lane={lane.id}>
      <div className="atlas-flow-lane-intro">
        <div>
          <p className="atlas-section-kicker"><Icon size={16} aria-hidden="true" />{meta.label}</p>
          <h3>{lane.title}</h3>
        </div>
        <p>{lane.description}</p>
      </div>
      <ol className="atlas-flow-stages" aria-label={`${lane.title}阶段`}>
        {lane.stages.map((stage, index) => (
          <li key={stage.title}>
            <span className="atlas-flow-stage-number" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
            <div className="atlas-flow-stage-copy"><h4>{stage.title}</h4><p>{stage.detail}</p></div>
          </li>
        ))}
      </ol>
    </div>
  )
}
