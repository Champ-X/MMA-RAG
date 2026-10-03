import { useId, useState } from 'react'
import { AudioLines, Bot, ChevronDown, FileText, Fingerprint, Image, Search, Video } from 'lucide-react'
import { ConnectorLayer } from './ConnectorLayer'
import './evidenceCircuit.css'

const sources = [
  { id: 'document', icon: FileText, title: '文档', label: '结构里的语义', representation: '章节、段落与表格', preparation: '解析与切分', encoding: '文本语义 + 稀疏索引', locator: '文件与片段元数据', detail: '按解析结果保留正文结构；电子表格使用行块、工作表摘要与列画像。', trace: '引用关联原始文件与命中的内容片段；可用的位置元数据随材料保留。' },
  { id: 'image', icon: Image, title: '图片', label: '画面里的线索', representation: '视觉内容与图像描述', preparation: '视觉理解', encoding: '描述语义 + CLIP 向量', locator: '原图与内容描述', detail: '图像描述回答“画面讲了什么”，视觉向量补充“它看起来像什么”。', trace: '引用关联原始图片，可回看画面，并与生成时使用的描述对照。' },
  { id: 'audio', icon: AudioLines, title: '音频', label: '声音里的信息', representation: '转写文本与声学特征', preparation: '语音转写', encoding: '转写语义 + CLAP 向量', locator: '原音频与转写内容', detail: '语音转写与声学表示分别保留内容和声音线索，共同参与按需检索。', trace: '引用保留原音频入口与转写或声音描述，可回听素材并对照文字线索。' },
  { id: 'video', icon: Video, title: '视频', label: '时间里的上下文', representation: '场景、镜头与关键帧', preparation: '镜头解析', encoding: '镜头描述 + 语音线索', locator: '镜头与时间范围', detail: '按场景与镜头组织画面，关联关键帧和语音线索，让证据保留时间上下文。', trace: '引用关联视频镜头与可用时间范围，可以回到素材中查看前后语境。' },
] as const

type SourceId = (typeof sources)[number]['id']

function Specimen({ source }: { source: SourceId }) {
  return <div className={`specimen-art specimen-art-${source}`} aria-hidden="true">
    <div className="specimen-registration"><span /><span /><span /><span /></div>
    {source === 'document' && <div className="specimen-pages"><div className="specimen-paper-back" /><div className="specimen-paper"><span className="specimen-paper-label">DOCUMENT / 原始结构</span><b>语义有层次，<br />来源有迹可循。</b><div className="specimen-lines"><i /><i /><i /></div><div className="specimen-selection"><span>段落与表格</span><div><i /><i /><i /><i /><i /><i /></div></div><small>结构 → 语义单元</small></div></div>}
    {source === 'image' && <div className="specimen-image"><svg viewBox="0 0 280 210"><defs><linearGradient id="specimen-sky" x2="0" y2="1"><stop stopColor="#badacf" /><stop offset="1" stopColor="#e3efe0" /></linearGradient></defs><rect width="280" height="210" rx="5" fill="url(#specimen-sky)" /><circle cx="203" cy="52" r="26" fill="#f5e5ae" /><path d="M0 172 94 39 187 178Z" fill="#609b8e" /><path d="m63 82 31-43 31 44-31-13Z" fill="#dfede3" /><path d="m90 210 105-114 85 69v45Z" fill="#2d716a" /><path d="M0 183q72-40 146 4t134-9v32H0Z" fill="#a4c6b6" /></svg><span className="specimen-image-region">视觉区域</span><span className="specimen-image-caption">画面特征 ↔ 内容描述</span></div>}
    {source === 'audio' && <div className="specimen-audio"><span>声学特征 / 语音内容</span><div className="specimen-wave">{[14,23,40,25,54,75,38,56,88,110,79,58,33,68,98,121,86,52,31,68,84,46,25,53,37,19,31,15].map((height,i)=><i key={i} style={{height}} />)}</div><div className="specimen-audio-track"><i /><span>语音片段</span><i /></div><div className="specimen-transcript"><span>转写文本</span><i /><i /><i /></div></div>}
    {source === 'video' && <div className="specimen-video"><span>SCENE → SHOT → KEY FRAME</span><div className="specimen-film">{[0,1,2].map(i=><div key={i}><svg viewBox="0 0 90 110"><rect width="90" height="110" fill={['#ead4ac','#d6ba90','#c1ad85'][i]} /><circle cx={30+i*18} cy={28+i*4} r="15" fill="#f9ecd2" /><path d={`M0 95 35 ${49+i*8} 90 97v13H0Z`} fill="#94714c" /><path d="m30 110 39-47 21 28v19Z" fill="#65594a" /></svg><small>镜头 {i+1}</small></div>)}</div><div className="specimen-video-track"><i /><i /><i /><span>保留时间顺序</span></div></div>}
  </div>
}

/** A structural illustration; no live retrieval or fabricated answer is presented. */
export function EvidenceCircuit() {
  const [sourceId, setSourceId] = useState<SourceId>('document')
  const [mode, setMode] = useState<'direct' | 'agent'>('direct')
  const [traceOpen, setTraceOpen] = useState(false)
  const descriptionId = useId()
  const traceId = useId()
  const source = sources.find(item => item.id === sourceId) ?? sources[0]
  const SourceIcon = source.icon

  return (
    <figure className="evidence-circuit" data-source={sourceId} data-mode={mode}>
      <figcaption className="circuit-heading"><span><Fingerprint size={17} aria-hidden="true" />一份证据的剖面</span><small>交互示意</small></figcaption>
      <div className="circuit-source-tabs" role="group" aria-label="探索素材模态">
        {sources.map(({id,icon:Icon,title})=><button key={id} type="button" data-source={id} aria-pressed={sourceId===id} aria-describedby={sourceId===id ? descriptionId : undefined} onClick={()=>setSourceId(id)}><Icon size={16} aria-hidden="true" /><span>{title}</span><i aria-hidden="true" /></button>)}
      </div>
      <div className="circuit-specimen" key={sourceId}>
        <Specimen source={sourceId} />
        <div className="circuit-specimen-copy" id={descriptionId}><p className="circuit-source-caption"><SourceIcon size={14} aria-hidden="true" />{source.title}的证据表示</p><h2>{source.label}</h2><p>{source.detail}</p><span className="circuit-representation">{source.representation}</span></div>
      </div>
      <div className="circuit-processing">
        <div className="circuit-mode-switch" role="group" aria-label="架构示意检索路径"><button type="button" aria-pressed={mode==='direct'} onClick={()=>setMode('direct')}><Search size={13} aria-hidden="true" />Direct<span>一次取证</span></button><button type="button" aria-pressed={mode==='agent'} onClick={()=>setMode('agent')}><Bot size={13} aria-hidden="true" />Agent<span>按需补查</span></button></div>
        <div className="circuit-process-route">
          <ConnectorLayer connections={[{ id: 'prepare-recall', from: 'prepare', to: 'recall' }, { id: 'recall-answer', from: 'recall', to: 'answer' }]} />
          <div><small>入库时</small><strong data-connection-node="prepare">{source.preparation}</strong></div>
          <div><small>提问时</small><strong data-connection-node="recall">召回 · 融合 · 精排</strong></div>
          <div><small>回答时</small><strong data-connection-node="answer">正文与引用</strong></div>
        </div>
        <p className="circuit-route-note" aria-live="polite">{mode==='direct' ? '直接路径：一次检索编排，汇集相关材料。' : 'Agent 路径：规划互补子查询，合并证据并按预算停止。'}</p>
      </div>
      <div className="circuit-provenance"><div><span className="circuit-citation-symbol" aria-hidden="true">[↗]</span><span><strong>引用始终连接来源</strong><small>{source.locator}</small></span></div><button type="button" aria-expanded={traceOpen} aria-controls={traceId} onClick={()=>setTraceOpen(open=>!open)}><span>如何定位</span><ChevronDown size={16} aria-hidden="true" /></button></div>
      <div id={traceId} className="circuit-trace" hidden={!traceOpen}><p>{source.trace}</p><small>来源可追溯，不等于回答已经完成事实核验。</small></div>
    </figure>
  )
}
