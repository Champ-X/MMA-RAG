import { translate as t, useTranslation } from '@/i18n'
import { useState } from 'react'
import * as Tabs from '@radix-ui/react-tabs'
import {
  ArrowUpRight, ChevronDown, Cpu, Database, FileInput, Library, MessageSquare,
  Repeat2, Search, ShieldCheck, Wrench,
} from 'lucide-react'
import { ArchitectureMode, architectureSourceUrl } from '@/data/architectureExperience'
import './architectureDetails.css'

type ModuleId = 'ingestion' | 'knowledge' | 'retrieval' | 'agent' | 'pi-host' | 'pi-runtime' | 'pi-tools' | 'generation'

const moduleDefinitions = [
  {
    id: 'ingestion' as const, name: '素材入库', caption: '解析与编码', icon: FileInput, family: '共享基础',
    title: '从原始材料到可检索表示',
    description: '按格式选择解析器，把文档、图片、音频与视频转成适合检索的表示，同时保留返回原件的路径。',
    receives: '文件、URL 或飞书来源，以及目标知识库。',
    does: '解析与 Agentic Chunking；服务端按原始单元无损物化正文；提取媒体描述、转写、镜头与关键帧并编码。',
    delivers: 'MinIO 原件和派生物；Qdrant 向量、词面索引及页码、片段、时间等定位。',
    sources: [
      { label: '入库服务', path: 'backend/app/modules/ingestion/service.py' },
      { label: '原文分块', path: 'backend/app/modules/ingestion/splitters/agentic.py' },
    ],
  },
  {
    id: 'knowledge' as const, name: '知识管理', caption: '目录与画像', icon: Library, family: '共享基础',
    title: '先明确资料，再确定范围',
    description: '文件目录、知识库画像与推荐问题提供组织入口；常规路径可借助画像路由到相关知识库。',
    receives: '知识库与文件元数据、索引内容，以及查询或目录请求。',
    does: '维护文件信息，生成主题画像与推荐问题；在没有显式范围时为常规检索选择候选知识库。',
    delivers: '可读目录、知识库画像、路由结果和来源导航。目录本身不代表已经阅读的证据。',
    sources: [
      { label: '知识库服务', path: 'backend/app/modules/knowledge/service.py' },
      { label: '画像路由', path: 'backend/app/modules/knowledge/router.py' },
    ],
  },
  {
    id: 'retrieval' as const, name: '常规检索', caption: '召回与重排', icon: Search, family: 'Direct / Agent',
    title: '多路检索，汇成一组证据',
    description: 'Direct 单次调用完整检索编排；常规 Agent 在补查时复用同一服务。Pi 的搜索工具有独立实现。',
    receives: '问题、明确的知识库或文件范围、模态需求与排除约束。',
    does: '意图分析、多视角查询、画像路由；按需执行 Dense、Sparse、CLIP、CLAP 与视频检索，再用 RRF 融合和 Cross-Encoder 重排。',
    delivers: '去重证据、来源定位、检索范围与覆盖记录，交给公共上下文构建器。',
    sources: [
      { label: 'RetrievalService', path: 'backend/app/modules/retrieval/service.py' },
      { label: '搜索引擎', path: 'backend/app/modules/retrieval/search_engine.py' },
    ],
  },
  {
    id: 'agent' as const, name: '有界 Agent', caption: '规划与补查', icon: Repeat2, family: '常规 RAG',
    title: '按预算迭代补查',
    description: '规划器决定继续搜索或进入回答；检索和最终生成仍沿用常规公共链路。',
    receives: '问题、上下文、搜索范围与已有证据。',
    does: '先用原问题建立证据锚点，再规划互补查询并调用只读检索工具。按轮数与查询预算补查；合并时限制证据量，并记录停止原因。',
    delivers: '证据集合、结构化执行阶段和停止原因，再交由公共生成服务组织回答。',
    sources: [
      { label: '有界循环', path: 'backend/app/modules/agent/service.py' },
      { label: '工具契约', path: 'backend/app/modules/agent/tools.py' },
    ],
  },
  {
    id: 'pi-host' as const, name: 'Pi 宿主', caption: '范围与账本', icon: ShieldCheck, family: '独立 Pi 体系',
    title: '宿主管理来源与交付边界',
    description: 'Python 宿主负责来源身份、并发准入、工具执行与 Node 进程监督，并持续保存任务事件和产物。',
    receives: 'Pi 请求、允许的知识库和文件、输入材料及模型选择。',
    does: '创建运行 ID，准备来源目录；校验工具范围、引用身份与交付状态；监督工作进程并持久化事件。',
    delivers: 'SQLite 任务账本、可续接的事件序号、带稳定编号与位置的证据，以及接受或拒绝的交付结果。',
    sources: [
      { label: '进程监督', path: 'backend/app/modules/pi_agent/supervisor.py' },
      { label: '持久账本', path: 'backend/app/modules/pi_agent/store.py' },
    ],
  },
  {
    id: 'pi-runtime' as const, name: 'Pi 运行时', caption: '自主工具循环', icon: Cpu, family: '独立 Pi 体系',
    title: 'Pi SDK 驱动自主研究',
    description: '独立 Node 进程负责研究规划、工具选择和最终生成，与常规检索及公共生成链分开运行。',
    receives: '用户要求、来源目录、宿主提供的工具契约与已取得的工具结果。',
    does: '按任务选择搜索、阅读、观察或计算工具；登记回答计划，归档旧内容并保留可复读的位置。',
    delivers: '工具调用、回答计划、最终 submit_answer 或澄清请求，由宿主检查并记录。',
    sources: [
      { label: 'SDK 运行时', path: 'agent-runtime/src/runtime.mjs' },
      { label: 'Node 工作进程', path: 'agent-runtime/src/worker.mjs' },
    ],
  },
  {
    id: 'pi-tools' as const, name: 'Pi 工具', caption: '深读与观察', icon: Wrench, family: '独立 Pi 体系',
    title: '按任务搜索、阅读与计算',
    description: '工具将原文阅读、媒体观察和表格计算交给受限的宿主执行；不同产物保留各自的证据含义。',
    receives: '宿主认可的来源 ID、查询、原文区间、媒体时间段或表格操作。',
    does: '独立语义与词面搜索、分页读原文和相邻片段、复读归档证据、观察原始媒体，以及确定性表格计算。',
    delivers: '原文、转写、模型观察或计算结果；附带稳定证据编号、版本和位置。工具不暴露任意 Shell 或代码执行。',
    sources: [
      { label: '工具分发', path: 'backend/app/modules/pi_agent/tools.py' },
      { label: '独立搜索', path: 'backend/app/modules/pi_agent/gateway.py' },
    ],
  },
  {
    id: 'generation' as const, name: '回答生成', caption: '上下文与引用', icon: MessageSquare, family: 'Direct / Agent',
    title: '从证据组织回答与引用',
    description: '常规 Direct 与 Agent 汇合到同一生成链。Pi 则由独立运行时写出答案，通过宿主提交契约交付。',
    receives: '问题、对话上下文、检索证据与稳定引用编号。',
    does: '构建上下文，调用生成模型并流式输出；收尾时选择实际采用的引用，按正文实际引用的编号筛选来源。',
    delivers: '回答正文、最终引用与可返回来源的定位；没有有效引用编号时不附带候选来源，编号匹配不等于语义核验。',
    sources: [
      { label: '上下文构建', path: 'backend/app/modules/generation/context_builder.py' },
      { label: '引用选择', path: 'backend/app/modules/generation/citation_selection.py' },
    ],
  },
]

const initialModule: Record<ArchitectureMode, ModuleId> = {
  direct: 'retrieval', agent: 'agent', pi: 'pi-runtime',
}

export function ArchitectureDetails({ mode }: { mode: ArchitectureMode }) {
  useTranslation()
  const [selection, setSelection] = useState<{ mode: ArchitectureMode; id: ModuleId }>({
    mode, id: initialModule[mode],
  })
  const selected = selection.mode === mode ? selection.id : initialModule[mode]

  return (
    <div className="atlas-details">
      <div className="atlas-section-intro">
        <h2>{t("深入关键模块")}</h2>
        <p>{t("沿着输入、处理与产物查看关键职责；每个模块都附有实现入口。")}</p>
      </div>

      <Tabs.Root value={selected} onValueChange={value => setSelection({ mode, id: value as ModuleId })} orientation="horizontal" className="atlas-module-explorer">
        <Tabs.List
          className="atlas-module-list"
          aria-label={t("查看架构模块")}
          onKeyDown={event => {
            if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
            if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
            const tabs = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'))
            const current = tabs.find(tab => tab === event.target)
            if (!current) return
            const currentRect = current.getBoundingClientRect()
            const down = event.key === 'ArrowDown'
            const next = tabs
              .filter(tab => tab !== current)
              .map(tab => ({ tab, rect: tab.getBoundingClientRect() }))
              .filter(({ rect }) => rect.width > 0 && (down ? rect.top >= currentRect.bottom - 1 : rect.bottom <= currentRect.top + 1))
              .sort((a, b) => {
                const aGap = down ? a.rect.top - currentRect.bottom : currentRect.top - a.rect.bottom
                const bGap = down ? b.rect.top - currentRect.bottom : currentRect.top - b.rect.bottom
                return aGap - bGap || Math.abs(a.rect.left - currentRect.left) - Math.abs(b.rect.left - currentRect.left)
              })[0]?.tab
            if (!next) return
            event.preventDefault()
            next.focus({ preventScroll: true })
            next.scrollIntoView({ block: 'nearest', inline: 'nearest' })
          }}
        >
          {moduleDefinitions.map(module => {
            const Icon = module.icon
            return (
              <Tabs.Trigger key={module.id} value={module.id} className="atlas-module-trigger">
                <Icon size={17} strokeWidth={1.6} aria-hidden="true" />
                <span><strong>{t(module.name)}</strong><small>{t(module.caption)}</small></span>
              </Tabs.Trigger>
            )
          })}
        </Tabs.List>
        {moduleDefinitions.map(module => (
          <Tabs.Content key={module.id} value={module.id} className="atlas-module-panel">
            <div className="atlas-module-heading">
              <div className="atlas-module-heading-line"><h3>{t(module.title)}</h3><span className="atlas-module-family">{t(module.family)}</span></div>
              <p>{t(module.description)}</p>
            </div>
            <dl className="atlas-module-contract">
              <div><dt>{t("输入")}</dt><dd>{t(module.receives)}</dd></div>
              <div><dt>{t("处理")}</dt><dd>{t(module.does)}</dd></div>
              <div><dt>{t("产物")}</dt><dd>{t(module.delivers)}</dd></div>
            </dl>
            <div className="atlas-module-source">
              <span><Database size={14} aria-hidden="true" />  {t("实现入口")}</span>
              {module.sources.map(source => (
                <a key={source.path} href={architectureSourceUrl(source.path)} target="_blank" rel="noreferrer">
                  {t(source.label)}<ArrowUpRight size={13} aria-hidden="true" />
                </a>
              ))}
            </div>
          </Tabs.Content>
        ))}
      </Tabs.Root>

      <div className="atlas-mechanisms" aria-label={t("贯穿模块的设计机制")}>
        <details className="atlas-mechanism">
          <summary>
            <span className="atlas-mechanism-copy">
              <span className="atlas-mechanism-title">{t("一种素材，多种表示")}</span>
              <span className="atlas-mechanism-description">{t("原件留在对象存储，语义与专用向量进入索引；每次命中都保留来源定位。")}</span>
            </span>
            <span className="atlas-mechanism-action"><span className="atlas-mechanism-show">{t("查看四种模态")}</span><span className="atlas-mechanism-hide">{t("收起说明")}</span><ChevronDown size={16} aria-hidden="true" /></span>
          </summary>
          <div className="atlas-mechanism-body">
            <dl className="atlas-modalities">
              <div><dt>{t("文档")}</dt><dd>{t("原文块 · Dense / Sparse")}</dd></div>
              <div><dt>{t("图片")}</dt><dd>{t("描述文本 · CLIP 视觉向量")}</dd></div>
              <div><dt>{t("音频")}</dt><dd>{t("转写 / 描述 · Sparse / CLAP")}</dd></div>
              <div><dt>{t("视频")}</dt><dd>{t("镜头描述 / ASR · Dense / Sparse；关键帧补充文本与 CLIP")}</dd></div>
            </dl>
            <p className="atlas-mechanism-note">{t("视频以镜头为主要语义单元。关键帧与离散采样不能证明已逐帧观察完整视频。")}</p>
            <a className="atlas-detail-link" href={architectureSourceUrl('docs/MULTIMODAL_IMAGE_AUDIO_VIDEO_TECHNICAL_SPEC.md')} target="_blank" rel="noreferrer">{t("多模态技术说明")} <ArrowUpRight size={13} aria-hidden="true" /></a>
          </div>
        </details>

        <details className="atlas-mechanism">
          <summary>
            <span className="atlas-mechanism-copy">
              <span className="atlas-mechanism-title">{t("阅读与搜索各有范围")}</span>
              <span className="atlas-mechanism-description">{t("选择知识库或文件限定搜索；@ 引用与本机附件供阅读、比较，不自动扩展搜索权限。")}</span>
            </span>
            <span className="atlas-mechanism-action"><span className="atlas-mechanism-show">{t("查看范围规则")}</span><span className="atlas-mechanism-hide">{t("收起说明")}</span><ChevronDown size={16} aria-hidden="true" /></span>
          </summary>
          <div className="atlas-mechanism-body">
            <ul className="atlas-detail-list">
              <li>{t("显式选择的知识库 / 文件范围严格生效。")}</li>
              <li>{t("常规路径未指定范围时，可通过知识库画像路由。")}</li>
              <li>{t("Pi 的来源目录区分可搜索文件与只读输入材料；目录与文件名都不是已读证据。")}</li>
              <li>{t("Pi 的 source_ids 只收窄本次搜索。")}</li>
            </ul>
            <a className="atlas-detail-link" href={architectureSourceUrl('docs/chat-inline-references.md')} target="_blank" rel="noreferrer">{t("引用与附件契约")} <ArrowUpRight size={13} aria-hidden="true" /></a>
          </div>
        </details>

        <details className="atlas-mechanism">
          <summary>
            <span className="atlas-mechanism-copy">
              <span className="atlas-mechanism-title">{t("引用可定位，含义需核对")}</span>
              <span className="atlas-mechanism-description">{t("引用编号与版本证明证据身份一致；回答中的事实与推论仍需与来源逐项对照。")}</span>
            </span>
            <span className="atlas-mechanism-action"><span className="atlas-mechanism-show">{t("查看证据含义")}</span><span className="atlas-mechanism-hide">{t("收起说明")}</span><ChevronDown size={16} aria-hidden="true" /></span>
          </summary>
          <div className="atlas-mechanism-body">
            <ul className="atlas-detail-list">
              <li><strong>{t("原文 / 解析文本：")}</strong>{t("来源片段及页码、字符或块位置。")}</li>
              <li><strong>{t("转写：")}</strong>{t("音视频语音的文本表示，保留时间定位。")}</li>
              <li><strong>{t("模型观察：")}</strong>{t("对原图片、页图或媒体区间的观察，具有采样与模型边界。")}</li>
              <li><strong>{t("表格计算：")}</strong>{t("确定性操作的结果，保留行号与计算范围。")}</li>
            </ul>
            <p className="atlas-mechanism-note">{t("过程阶段、工具参数与产物可供检查；它们不是模型私有思维链，也不自动成为最终引用。")}</p>
            <a className="atlas-detail-link" href={architectureSourceUrl("docs/PI_AGENT_MODE.md#原文与媒体契约")} target="_blank" rel="noreferrer">{t("证据契约")} <ArrowUpRight size={13} aria-hidden="true" /></a>
          </div>
        </details>
      </div>
    </div>
  )
}
