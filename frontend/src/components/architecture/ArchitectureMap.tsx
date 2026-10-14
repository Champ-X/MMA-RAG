import { useRef, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { ArrowRight, AudioLines, Bot, Braces, ChevronRight, Code2, Database, FileText, Image, Layers3, Search, ShieldCheck, Sparkles, Video, X } from 'lucide-react'
import { architectureSourceUrl, type ArchitectureMode } from '@/data/architectureExperience'

const contracts = {
  ingestion: { title: '素材准备', subtitle: '先理解，再建立索引', receives: '文件、网页、飞书文档与媒体素材', does: '按模态解析；文档保留原文，表格保留表头与行块，视频按场景、镜头和关键帧组织。', delivers: '原始对象、可定位的片段、多模态索引与知识库画像', path: 'backend/app/modules/ingestion/service.py' },
  retrieval: { title: '常规检索编排', subtitle: '问题 → 排序后的证据', receives: '问题、会话上下文与知识库 / 文件范围', does: '理解意图、改写与画像路由，按需执行 Dense、Sparse、图片、音频及视频召回，再进行 RRF 融合与 Cross-Encoder 精排。', delivers: '带来源和媒体定位的 RetrievalResult', path: 'backend/app/modules/retrieval/service.py' },
  agent: { title: '有界 Agent 补查', subtitle: '规划 → 搜索 → 观察', receives: '原问题证据、范围与执行预算', does: '规划互补子问题，继续调用常规检索服务；跨轮去重，证据足够、无新增结果或预算耗尽时停止。', delivers: '合并证据与补查记录，随后进入公共生成链', path: 'backend/app/modules/agent/service.py' },
  context: { title: '上下文与引用', subtitle: '材料 → 来源编号', receives: '常规检索或有界 Agent 合并后的证据', does: '按模态与长度预算选择材料，建立来源编号并补充可用的相邻段落与媒体定位。', delivers: '生成上下文与 ReferenceMap', path: 'backend/app/modules/generation/context_builder.py' },
  generation: { title: '回答交付', subtitle: '正文与实际采用的来源', receives: '生成上下文、问题与引用映射', does: '流式生成正文，完成时仅保留正文实际采用的引用；无依据回答不附带候选来源。', delivers: '回答、最终来源与流式结束事件', path: 'backend/app/modules/generation/service.py' },
  pi: { title: 'Pi Agent 循环', subtitle: '独立的规划、工具选择与生成', receives: '用户任务、允许的模型、宿主提供的来源与工具', does: '由 Pi SDK 决定研究步骤、调用工具并写出答案。旧工具内容可归档，保留证据定位供复读。', delivers: '工具调用、研究产物与最终答案提交', path: 'agent-runtime/src/runtime.mjs' },
  tools: { title: '只读来源工具', subtitle: '搜索 · 深读 · 媒体 · 表格', receives: 'Pi 选择的工具参数与宿主限定的来源', does: '独立的语义 / 词面搜索，原文续读与上下文扩展，直接观察媒体，或对原表进行确定性计算。', delivers: '带身份、位置、版本和证据类型的工具结果', path: 'backend/app/modules/pi_agent/tools.py' },
  host: { title: 'Pi 宿主与账本', subtitle: '范围、身份与交付校验', receives: '任务、工具调用、Pi 提交的答案与引用', does: '约束来源访问，监督独立 Node 进程，持续保存事件与证据，并校验引用身份和交付状态。', delivers: '可续接的任务事件、证据与正式回答；身份校验不等于事实核验', path: 'backend/app/modules/pi_agent/supervisor.py' },
} as const
type ContractId = keyof typeof contracts

export function ArchitectureMap({ mode }: { mode: ArchitectureMode }) {
  const [selected, setSelected] = useState<ContractId>('retrieval')
  const [open, setOpen] = useState(false)
  const opener = useRef<HTMLButtonElement | null>(null)
  const contract = contracts[selected]
  const select = (id: ContractId, button: HTMLButtonElement) => { opener.current = button; setSelected(id); setOpen(true) }
  const node = (id: ContractId, title: string, sub: string, Icon: typeof Search) => (
    <button type="button" className="atlas-map-node" onClick={event => select(id, event.currentTarget)} aria-label={`查看${contracts[id].title}职责`}>
      <Icon size={17} strokeWidth={1.7} aria-hidden="true" /><span><strong>{title}</strong><small>{sub}</small></span><ChevronRight size={13} aria-hidden="true" />
    </button>
  )
  return <Dialog.Root open={open} onOpenChange={setOpen}>
    <figure className="atlas-system-map" data-mode={mode}>
      <figcaption><span><Layers3 size={16} aria-hidden="true" />两套执行体系，共同连接来源</span><small>点击节点查看职责</small></figcaption>
      <div className="atlas-source-rail">
        <div className="atlas-source-types"><span><FileText size={15} aria-hidden="true" />文档 / 表格</span><span><Image size={15} aria-hidden="true" />图片</span><span><AudioLines size={15} aria-hidden="true" />音频</span><span><Video size={15} aria-hidden="true" />视频</span></div>
        <ArrowRight size={16} className="atlas-map-arrow" aria-hidden="true" />
        <button type="button" onClick={event => select('ingestion', event.currentTarget)}>解析与索引<ChevronRight size={14} aria-hidden="true" /></button>
        <ArrowRight size={16} className="atlas-map-arrow" aria-hidden="true" />
        <span className="atlas-source-stores"><Database size={15} aria-hidden="true" />MinIO 原件 · Qdrant 索引</span>
      </div>
      <div className="atlas-system-lane is-standard" data-active={mode !== 'pi'}>
        <div className="atlas-lane-label"><span>常规 RAG</span><small>{mode === 'agent' ? '有界多轮补查' : '单次检索编排'}</small></div>
        <div className="atlas-map-route">
          {node(mode === 'agent' ? 'agent' : 'retrieval', mode === 'agent' ? '规划与补查' : '检索编排', mode === 'agent' ? '↔ 复用检索服务' : '意图 · 召回 · 排序', mode === 'agent' ? Bot : Search)}
          <ArrowRight className="atlas-map-arrow" size={17} aria-hidden="true" />
          {node('context', '材料与引用', 'ContextBuilder', Braces)}
          <ArrowRight className="atlas-map-arrow" size={17} aria-hidden="true" />
          {node('generation', '流式回答', '正文实际引用', Sparkles)}
        </div>
      </div>
      <div className="atlas-system-lane is-pi" data-active={mode === 'pi'}>
        <div className="atlas-lane-label"><span><span className="atlas-pi-symbol" aria-hidden="true">π</span>Pi Agent</span><small>独立 Node 运行时</small></div>
        <div className="atlas-map-route">
          {node('pi', '自主研究', 'Pi SDK 循环', Bot)}
          <span className="atlas-map-return" aria-hidden="true">⇄</span>
          {node('tools', '来源工具', '搜索 · 深读 · 观察', Search)}
          <ArrowRight className="atlas-map-arrow" size={17} aria-hidden="true" />
          {node('host', '宿主与账本', '校验 · 持久交付', ShieldCheck)}
        </div>
      </div>
      <div className="atlas-map-footnote"><span className="atlas-map-state" aria-hidden="true" /><p>{mode === 'pi' ? 'Pi 独立搜索与生成；宿主保存事件和证据，约束来源访问。' : mode === 'agent' ? 'Agent 在预算内补查，合并证据后沿用常规上下文与生成链。' : 'Direct 一次检索编排；按问题选择召回通道，随后组织回答。'}</p></div>
    </figure>
    <Dialog.Portal>
      <Dialog.Overlay className="atlas-contract-overlay" />
      <Dialog.Content className="atlas-contract-dialog" onCloseAutoFocus={event => { event.preventDefault(); opener.current?.focus() }}>
        <div className="atlas-contract-dialog-top"><span>模块职责</span><Dialog.Close asChild><button type="button" aria-label="关闭模块职责"><X size={20} aria-hidden="true" /></button></Dialog.Close></div>
        <Dialog.Title>{contract.title}</Dialog.Title><Dialog.Description>{contract.subtitle}</Dialog.Description>
        <dl><div><dt>接收什么</dt><dd>{contract.receives}</dd></div><div><dt>执行什么</dt><dd>{contract.does}</dd></div><div><dt>交付什么</dt><dd>{contract.delivers}</dd></div></dl>
        <a href={architectureSourceUrl(contract.path)} target="_blank" rel="noreferrer"><Code2 size={16} aria-hidden="true" /><span>{contract.path}</span><ArrowRight size={16} aria-hidden="true" /></a>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>
}
