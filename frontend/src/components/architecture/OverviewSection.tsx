import { AudioLines, Check, FileText, Image, Layers3, LockKeyhole, ScanLine, Video } from 'lucide-react'
import { FlowArrow } from './ConnectorLayer'
import { EvidenceConfluence } from './EvidenceConfluence'
import './architectureSections.css'

const modalities = [
  { icon: FileText, name: '文档', detail: '解析结构', tone: 'document' },
  { icon: Image, name: '图像', detail: '画面与语义', tone: 'image' },
  { icon: AudioLines, name: '音频', detail: '转写与声学', tone: 'audio' },
  { icon: Video, name: '视频', detail: '场景与镜头', tone: 'video' },
] as const

export function OverviewSection() {
  return (
    <section id="overview" className="atlas-overview-section scroll-mt-24">
      <div className="atlas-section-intro">
        <div>
          <p className="atlas-section-kicker">设计原则 <span aria-hidden="true">/</span> Evidence first</p>
          <h2>素材有原貌，答案有来路</h2>
        </div>
        <p>系统围绕同一个约定展开：保留来源、共用检索、约束探索，再把回答连接回实际引用的证据。</p>
      </div>

      <div className="atlas-doctrine-spread">
        <article className="atlas-evidence-folio">
          <p className="atlas-doctrine-label"><ScanLine size={16} aria-hidden="true" />来源留存</p>
          <h3>理解不同媒介，<br />保留来源线索。</h3>
          <p className="atlas-doctrine-description">文档、画面、声音与镜头分别解析。按解析结果保留内容结构，并记录可用的来源信息。</p>

          <div className="atlas-evidence-sources">
            <EvidenceConfluence />
            <ul className="atlas-modal-specimens" role="list" aria-label="四类素材保留的信息">
              {modalities.map(({ icon: Icon, name, detail, tone }) => (
                <li className={`atlas-modal-specimen atlas-modal-specimen-${tone}`} data-confluence-source={tone} key={name}>
                  <Icon size={25} strokeWidth={1.4} aria-hidden="true" />
                  <span>{name}</span><small>{detail}</small>
                </li>
              ))}
            </ul>
            <div className="atlas-evidence-thread" aria-hidden="true">
              <span className="atlas-confluence-junction" data-confluence-target />
              <FlowArrow vertical className="atlas-evidence-spine" />
            </div>
          </div>

          <div className="atlas-citation-contract">
            <span className="atlas-citation-mark" aria-hidden="true">[n]</span>
            <div>
              <p className="atlas-doctrine-label">引用收敛</p>
              <h4>来源跟随正文，完成时再收敛</h4>
              <p>先预载候选来源，回答完成后仅保留正文实际使用的引用编号。引用连接对应素材，并携带可用的定位信息。</p>
            </div>
          </div>
          <p className="atlas-doctrine-footnote">可追溯，让核验有据可依；引用筛选本身不等于事实核验。</p>
        </article>

        <div className="atlas-retrieval-folio">
          <article className="atlas-shared-principle">
            <p className="atlas-doctrine-label"><Layers3 size={16} aria-hidden="true" />检索共用</p>
            <h3>两种节奏，<br />一个检索底座。</h3>
            <dl className="atlas-path-comparison">
              <div><dt>Direct<FlowArrow /></dt><dd><strong>一次取证</strong><span>执行检索后直接组织回答。</span></dd></div>
              <div><dt>Agent<Layers3 size={16} aria-hidden="true" /></dt><dd><strong>迭代取证</strong><span>规划互补子查询，合并多轮证据。</span></dd></div>
            </dl>
            <div className="atlas-retrieval-common"><Layers3 size={17} aria-hidden="true" /><p>画像路由 · 混合召回 · 融合精排<small>两条路径最终汇入同一检索结果与引用映射</small></p></div>
          </article>

          <article className="atlas-bounded-principle">
            <div className="atlas-bounded-heading"><p className="atlas-doctrine-label"><LockKeyhole size={16} aria-hidden="true" />探索有界</p><span>只读工具</span></div>
            <h3>深入取证，也知道何时停止。</h3>
            <p>Agent 只调用知识检索工具；轮数、查询总量与证据池设有预算，达到边界便停止扩展。</p>
            <ul className="atlas-budget-limits" role="list" aria-label="探索预算包含轮数、查询量和证据量">
              {['轮数', '查询', '证据'].map((label) => <li key={label}><span>{label}</span><i aria-hidden="true"><b /><b /><b /><b /></i><small>有上限</small></li>)}
            </ul>
          </article>
        </div>
      </div>
      <div className="atlas-scope-contract"><Check size={16} aria-hidden="true" /><p>无论选择哪条路径，用户指定的知识库与文件范围都传入检索工具。</p><span>范围贯穿全程</span></div>
    </section>
  )
}
