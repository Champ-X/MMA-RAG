import { translate as t, useTranslation } from '@/i18n'
import { useEffect, useRef, useState } from 'react'
import { ArrowDown, ArrowRight, ArrowUpRight, AudioLines, Bot, Braces, Check, ChevronRight, Code2, Database, FileText, Image, Layers3, MessageSquare, Repeat2, Search, ShieldCheck, Video, X } from 'lucide-react'
import { architectureModes, architectureSourceUrl, type ArchitectureMode } from '@/data/architectureExperience'
import './architectureMap.css'

const contracts = {
  ingestion: { title: '素材准备', subtitle: '先理解，再建立索引', receives: '文件、网页、飞书文档与媒体素材', does: '按模态解析；文档保留原文，表格保留表头与行块，视频按场景、镜头和关键帧组织。', delivers: '原始对象、可定位的片段、多模态索引与知识库画像', path: 'backend/app/modules/ingestion/service.py' },
  retrieval: { title: '常规检索编排', subtitle: '问题 → 排序后的证据', receives: '问题、会话上下文与知识库 / 文件范围', does: '理解意图、改写与画像路由，按需执行 Dense、Sparse、图片、音频及视频召回，再进行 RRF 融合与 Cross-Encoder 精排。', delivers: '带来源和媒体定位的 RetrievalResult', path: 'backend/app/modules/retrieval/service.py' },
  agent: { title: '有界 Agent 补查', subtitle: '规划 → 搜索 → 观察', receives: '原问题证据、范围与执行预算', does: '规划互补子问题，继续调用常规检索服务；先完成原问题检索，再规划补查；证据足够、无新增结果或轮数 / 查询预算耗尽时停止。', delivers: '合并证据与补查记录，随后进入公共生成链', path: 'backend/app/modules/agent/service.py' },
  context: { title: '上下文与引用', subtitle: '材料 → 来源编号', receives: '常规检索或有界 Agent 合并后的证据', does: '按模态与长度预算选择材料，建立来源编号并补充可用的相邻段落与媒体定位。', delivers: '生成上下文与 ReferenceMap', path: 'backend/app/modules/generation/context_builder.py' },
  generation: { title: '回答交付', subtitle: '正文与实际采用的来源', receives: '生成上下文、问题与引用映射', does: '流式生成正文，完成时仅保留正文实际采用的引用；没有有效引用编号时不附带候选来源；编号匹配不等于语义核验。', delivers: '回答、最终来源与流式结束事件', path: 'backend/app/modules/generation/service.py' },
  pi: { title: 'Pi Agent 循环', subtitle: '独立的规划、工具选择与生成', receives: '用户任务、允许的模型、宿主提供的来源与工具', does: '由 Pi SDK 决定研究步骤、调用工具并写出答案。旧工具内容可归档，保留证据定位供复读。', delivers: '工具调用、研究产物与最终答案提交', path: 'agent-runtime/src/runtime.mjs' },
  tools: { title: '只读来源工具', subtitle: '搜索 · 深读 · 媒体 · 表格', receives: 'Pi 选择的工具参数与宿主限定的来源', does: '独立的语义 / 词面搜索，原文续读与上下文扩展，直接观察媒体，或对原表进行确定性计算。', delivers: '带身份、位置、版本和证据类型的工具结果', path: 'backend/app/modules/pi_agent/tools.py' },
  host: { title: 'Pi 宿主与账本', subtitle: '范围、身份与交付校验', receives: '任务、工具调用、Pi 提交的答案与引用', does: '约束来源访问，监督独立 Node 进程，持续保存事件与证据，并校验引用身份和交付状态。', delivers: '可续接的任务事件、证据与正式回答；身份校验不等于事实核验', path: 'backend/app/modules/pi_agent/supervisor.py' },
} as const
type ContractId = keyof typeof contracts

const paths = {
  direct: { title: '一次检索，组织回答', description: '常规 RAG · Python', fit: '事实查找、聚焦问答', tradeoff: '单次完整检索后生成；不主动进入多轮研究。', note: '按问题选择检索通道，融合与重排后进入公共生成链。' },
  agent: { title: '先取证，再按需补查', description: '常规 RAG · Python', fit: '对比、综合与有限补查', tradeoff: '按轮数和查询预算推进，合并证据后统一生成。', note: '以原问题检索为起点，在预算内补查；合并证据后沿用公共生成链。' },
  pi: { title: '自主研究，按证据交付', description: '独立 Agent · Node + Python', fit: '反复深读、媒体核对、表格研究', tradeoff: '自主选择工具；宿主限定来源并记录任务，默认无累计工具次数上限。', note: 'Pi 独立选择工具并生成答案；Python 宿主约束来源、保存事件与证据。' },
} as const

export function ArchitectureMap({ mode, onModeChange }: { mode: ArchitectureMode; onModeChange: (mode: ArchitectureMode) => void }) {
  useTranslation()
  const [selected, setSelected] = useState<ContractId | null>(null)
  const opener = useRef<HTMLButtonElement | null>(null)
  const detailHeading = useRef<HTMLHeadingElement>(null)
  const contract = selected ? contracts[selected] : null
  const isPi = mode === 'pi'
  const path = paths[mode]
  useEffect(() => { setSelected(null) }, [mode])
  const select = (id: ContractId, button: HTMLButtonElement) => {
    if (selected === id) { setSelected(null); return }
    opener.current = button
    setSelected(id)
    window.requestAnimationFrame(() => {
      detailHeading.current?.focus({ preventScroll: true })
      detailHeading.current?.scrollIntoView({ block: 'nearest', behavior: 'auto' })
    })
  }
  const node = (id: ContractId, title: string, sub: string, Icon: typeof Search) => (
    <button type="button" className="atlas-flow-node" aria-expanded={selected === id} aria-controls="architecture-node-detail" onClick={event => select(id, event.currentTarget)} aria-label={t("查看{{value1}}职责", { value1: t(contracts[id].title) })}>
      <Icon size={20} strokeWidth={1.6} aria-hidden="true" /><span><strong>{t(title)}</strong><small>{t(sub)}</small></span><ChevronRight size={15} aria-hidden="true" />
    </button>
  )
  return <div className="atlas-map-explorer" data-path={mode}>
    <div className="atlas-path-picker" role="group" aria-label={t("选择架构执行路径")}>
      {architectureModes.map(item => <button key={item.id} type="button" aria-pressed={mode === item.id} onClick={() => onModeChange(item.id)}>
        {item.id === 'pi' ? <span className="atlas-pi-glyph" aria-hidden="true">π</span> : item.id === 'agent' ? <Repeat2 size={18} aria-hidden="true" /> : <Search size={18} aria-hidden="true" />}
        <strong>{t(item.name || '')}</strong><span>{t(item.label || '')}</span>{mode === item.id && <Check size={15} className="atlas-path-check" aria-hidden="true" />}
      </button>)}
    </div>
    <figure className="atlas-flow-map" aria-label={t("{{value1}} 架构路径", { value1: mode === 'pi' ? 'Pi Agent' : mode === 'agent' ? 'Agent' : 'Direct' })}>
      <figcaption className="atlas-flow-title"><h3>{t(path.title || '')}</h3><span>{t(path.description || '')}</span></figcaption>
      <div className="atlas-flow-canvas">
        <div className="atlas-materials">
          <h3>{t("多模态资料")}</h3>
          <div className="atlas-material-list">
            <span><FileText size={18} aria-hidden="true" />{t("文档与表格")}</span>
            <span><Image size={18} aria-hidden="true" />{t("图片")}</span>
            <span><AudioLines size={18} aria-hidden="true" />{t("音频")}</span>
            <span><Video size={18} aria-hidden="true" />{t("视频")}</span>
          </div>
          <button type="button" className="atlas-prepare-link" aria-expanded={selected === 'ingestion'} aria-controls="architecture-node-detail" onClick={event => select('ingestion', event.currentTarget)}>{t("解析与索引")}<ArrowUpRight size={15} aria-hidden="true" /></button>
          <div className="atlas-material-storage"><Database size={16} aria-hidden="true" /><span><span>{t("MinIO 保留原件")}</span><span>{t("Qdrant 建立索引")}</span></span></div>
        </div>
        <ArrowRight className="atlas-flow-connector" size={24} strokeWidth={1.3} aria-hidden="true" />
        <div className={`atlas-processing ${isPi ? 'atlas-processing--pi' : ''}`}>
          {isPi ? <>
            <button type="button" className="atlas-host-boundary" aria-expanded={selected === 'host'} aria-controls="architecture-node-detail" onClick={event => select('host', event.currentTarget)}><ShieldCheck size={17} aria-hidden="true" /><span>{t("Python 宿主")}<small>{t("来源范围 · 任务账本 · 交付校验")}</small></span><ChevronRight size={14} aria-hidden="true" /></button>
            <div className="atlas-pi-loop">
              {node('pi', t("Pi 自主循环"), t("规划、选择工具、生成答案"), Bot)}
              <div className="atlas-loop-link"><Repeat2 size={17} aria-hidden="true" /><span>{t("调用工具 / 返回证据")}</span></div>
              {node('tools', t("只读来源工具"), t("独立搜索、原文深读、媒体观察"), Search)}
            </div>
          </> : <>
            <div className="atlas-processing-label"><Layers3 size={16} aria-hidden="true" /><span>{t(mode === 'agent' ? t("有界补查，共用检索与生成") : t("常规检索与生成"))}</span></div>
            {node(mode === 'agent' ? 'agent' : 'retrieval', mode === 'agent' ? t("原问题检索 + 补查") : t("检索相关证据"), mode === 'agent' ? t("规划子问题、补查、去重合并") : t("意图、召回、融合与重排"), mode === 'agent' ? Repeat2 : Search)}
            <ArrowDown className="atlas-inner-arrow" size={17} aria-hidden="true" />
            {node('context', t("组织上下文"), t("选择材料，建立引用映射"), Braces)}
            <ArrowDown className="atlas-inner-arrow" size={17} aria-hidden="true" />
            {node('generation', t("生成回答"), t("流式正文，保留实际引用"), MessageSquare)}
          </>}
        </div>
        <ArrowRight className="atlas-flow-connector" size={24} strokeWidth={1.3} aria-hidden="true" />
        <div className="atlas-delivery">
          <MessageSquare size={27} strokeWidth={1.4} aria-hidden="true" />
          <h3>{t("有据可查的回答")}</h3>
          <p>{t("正文与引用一起交付，")}<br />{t("每条来源可返回原处。")}</p>
          <dl><div><dt>{t("文档")}</dt><dd>{t("页码 / 原文片段")}</dd></div><div><dt>{t("媒体")}</dt><dd>{t("时间 / 镜头位置")}</dd></div><div><dt>{t("证据")}</dt><dd>{t(isPi ? t("身份 / 版本 / 类型") : t("来源 / 实际引用"))}</dd></div></dl>
        </div>
      </div>
      <div className="atlas-flow-note"><p>{t(path.note || '')}</p><span>{t("架构示意")}</span></div>
    </figure>
    <div id="architecture-node-detail" hidden={!contract} className="atlas-node-detail">
      {contract && <>
        <div className="atlas-node-detail-heading"><div><h3 ref={detailHeading} tabIndex={-1}>{t(contract.title || '')}</h3><p>{t(contract.subtitle || '')}</p></div><button type="button" aria-label={t("收起模块职责")} onClick={() => { setSelected(null); opener.current?.focus() }}><X size={19} aria-hidden="true" /></button></div>
        <dl><div><dt>{t("输入")}</dt><dd>{t(contract.receives || '')}</dd></div><div><dt>{t("处理")}</dt><dd>{t(contract.does || '')}</dd></div><div><dt>{t("产物")}</dt><dd>{t(contract.delivers || '')}</dd></div></dl>
        <a href={architectureSourceUrl(contract.path)} target="_blank" rel="noreferrer"><Code2 size={16} aria-hidden="true" /><span>{t(contract.path || '')}</span><ArrowUpRight size={16} aria-hidden="true" /></a>
      </>}
    </div>
    <div className="atlas-system-distinction"><p><strong>{t("适合的任务")}</strong><span>{t(path.fit || '')}</span></p><p><strong>{t("执行方式与取舍")}</strong><span>{t(path.tradeoff || '')}</span></p></div>
  </div>
}
