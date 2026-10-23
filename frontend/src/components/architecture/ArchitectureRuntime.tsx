import { translate as t, useTranslation } from '@/i18n'
import { ArrowDown, ArrowUpRight, ChevronDown, Server } from 'lucide-react'
import { ArchitectureMode, architectureSourceUrl } from '@/data/architectureExperience'
import './architectureRuntime.css'

export function ArchitectureRuntime({ mode }: { mode: ArchitectureMode }) {
  useTranslation()
  const isPi = mode === 'pi'

  return (
    <div className="atlas-runtime">
      <div className="atlas-section-intro">
        <h2>{t("运行状态与恢复边界")}</h2>
        <p>{t("原件、索引与任务账本分别保存。浏览器断线、用户停止和服务重启，对应不同的恢复语义。")}</p>
      </div>

      <details className="atlas-runtime-topology-disclosure"><summary>{t("查看服务拓扑与存储职责")}<ChevronDown size={18} aria-hidden="true" /></summary>
      <div className="atlas-topology" aria-label={t("Tessmora 服务与存储拓扑")}>
        <div className="atlas-topology-entry">
          <div className="atlas-topology-icon"><Server size={22} strokeWidth={1.5} aria-hidden="true" /></div>
          <div><h3>{t("React 前端与 FastAPI")}</h3><p>{t("通过 HTTP / SSE 传递请求、会话上下文与公开证据")}</p><span className="atlas-topology-transport">{t("支持 Web、CLI 与 API 接入")}</span></div>
        </div>
        <div className="atlas-topology-connect"><ArrowDown size={18} strokeWidth={1.4} aria-hidden="true" /><span>{t("进入对应执行体系")}</span></div>
        <div className="atlas-execution-grid">
          <article className={`atlas-execution-node${!isPi ? ' is-selected' : ''}`}>
            <div className="atlas-execution-heading"><h3>{t("Direct / 有界 Agent")}</h3>{!isPi && <span className="atlas-current-path">{t("当前路径")}</span>}</div>
            <p className="atlas-execution-host">{t("Python 内执行")}</p>
            <p>{t("共享检索编排与公共生成链，通过 SSE 返回正文、阶段与引用。")}</p>
            <div className="atlas-runtime-services"><code>RetrievalService</code><code>GenerationService</code></div>
          </article>
          <article className={`atlas-execution-node atlas-execution-pi${isPi ? ' is-selected' : ''}`}>
            <div className="atlas-execution-heading"><h3>Pi Agent SDK</h3>{isPi && <span className="atlas-current-path">{t("当前路径")}</span>}</div>
            <p className="atlas-execution-host">{t("Python 宿主与独立 Node 工作进程")}</p>
            <p>{t("每任务工作进程自主选择工具；宿主管理范围、执行、监督与持久事件。")}</p>
            <div className="atlas-runtime-services"><span>{t("受限来源工具")}</span><span>{t("任务事件账本")}</span></div>
          </article>
        </div>
        <div className="atlas-topology-connect"><ArrowDown size={18} strokeWidth={1.4} aria-hidden="true" /><span>{t("读取来源 · 保存产物")}</span></div>
        <dl className="atlas-storage-list">
          <div><dt>MinIO</dt><dd>{t("原文件、解析文本与媒体派生物")}</dd><dd className="atlas-storage-scope">{t("共享来源")}</dd></div>
          <div><dt>Qdrant</dt><dd>{t("多模态向量、词面索引与知识库画像")}</dd><dd className="atlas-storage-scope">{t("共享索引")}</dd></div>
          <div className={isPi ? 'is-pi-store' : ''}><dt>{t("SQLite + 本地文件")}</dt><dd>{t("Pi 任务、事件、证据、附件与预览")}</dd><dd className="atlas-storage-scope">{t("Pi 独立持久化")}</dd></div>
          <div><dt>Redis / Celery</dt><dd>{t("可选任务控制，不作为在线证据来源")}</dd><dd className="atlas-storage-scope">{t("启动器默认不启 Celery")}</dd></div>
        </dl>
        <p className="atlas-topology-caption">{t("开发环境推荐本机 Python / Node 配合 Docker 存储服务。以上为职责关系，并非实时服务状态。")}</p>
      </div>

      </details>

      <div className="atlas-lifecycle">
        <div className="atlas-lifecycle-title"><h3>{t("断线与重启后，哪些状态还在？")}</h3></div>
        <div className="atlas-lifecycle-columns">
          <article className={!isPi ? 'is-current-path' : ''}>
            <h4>{t("常规 Direct / Agent")}</h4>
            <dl>
              <div><dt>{t("对话保存")}</dt><dd>{t("服务端会话主要在进程内；浏览器保存对话快照，支持显式恢复。")}</dd></div>
              <div><dt>{t("浏览器断线")}</dt><dd>{t("流式连接可能中断；本地快照用于恢复对话，不提供 Pi 式任务事件重放。")}</dd></div>
              <div><dt>{t("服务重启")}</dt><dd>{t("进程内会话状态丢失。快照恢复不等同于共享数据库或多副本同步。")}</dd></div>
            </dl>
          </article>
          <article className={isPi ? 'is-current-path' : ''}>
            <h4>{t("Pi 任务")}</h4>
            <dl>
              <div><dt>{t("任务保存")}</dt><dd>{t("任务、事件与证据持续写入 SQLite 账本；附件和预览留在本地数据目录。")}</dd></div>
              <div><dt>{t("浏览器断线")}</dt><dd>{t("后台任务继续，刷新可按事件序号续接。用户点击停止才取消任务与工作进程。")}</dd></div>
              <div><dt>{t("服务重启")}</dt><dd>{t("未完成任务标为中断，不自动重放付费请求；继续提问创建关联的新运行。")}</dd></div>
            </dl>
          </article>
        </div>
      </div>

      <div className="atlas-runtime-boundaries">
        <details className="atlas-runtime-disclosure" open>
          <summary><span>{t("当前路径的执行约束")}</span><span className="atlas-disclosure-tag">{t(isPi ? 'Pi Agent' : mode === 'agent' ? t("有界 Agent") : 'Direct')}</span><ChevronDown size={18} aria-hidden="true" /></summary>
          <div className="atlas-runtime-disclosure-body">
            {isPi ? (
              <p>{t("Pi 默认没有应用层累计 Token、总时长或工具次数上限。并发槽位、常规对话优先级、模型上下文、服务商容量与机器资源仍约束运行；排队任务可以取消。上下文归档保留证据定位，原产物可复读。")}</p>
            ) : mode === 'agent' ? (
              <p>{t("常规 Agent 按轮数与查询预算补查，合并时限制证据量，记录停止原因后进入公共生成链。auto 可按复杂度选择 Direct 或 Agent；这些预算与 Pi 的并发调度是不同机制。")}</p>
            ) : (
              <p>{t("Direct 单次调用完整检索编排后进入公共生成链。范围、模态与排除约束在检索时生效；这条路径没有 Pi 的自主工具循环或持久任务账本。")}</p>
            )}
            <a className="atlas-detail-link" href={architectureSourceUrl(isPi ? t("docs/PI_AGENT_MODE.md#配置与资源") : 'backend/app/modules/agent/service.py')} target="_blank" rel="noreferrer">{t(isPi ? t("Pi 资源与配置") : t("常规执行实现"))} <ArrowUpRight size={13} aria-hidden="true" /></a>
          </div>
        </details>
        <details className="atlas-runtime-disclosure">
          <summary><span>{t("Decision 与实验性检查")}</span><span className="atlas-disclosure-tag">{t("默认关闭")}</span><ChevronDown size={18} aria-hidden="true" /></summary>
          <div className="atlas-runtime-disclosure-body">
            <p>{t("Decision 是常规链路的可选核验组件，用于来源需求核对或回答引用诊断，具有独立的失败、跳过与未覆盖记录。它不参与 Pi 编排。")}</p>
            <p>{t("Pi 默认开启回答计划；正文单元与来源片段绑定的实验检查另有开关，默认关闭。引用身份检查和计划状态检查都不能证明每句话被来源蕴含。")}</p>
            <div className="atlas-runtime-links">
              <a className="atlas-detail-link" href={architectureSourceUrl('docs/DECISION_MODELS.md')} target="_blank" rel="noreferrer">{t("Decision 说明")} <ArrowUpRight size={13} aria-hidden="true" /></a>
              <a className="atlas-detail-link" href={architectureSourceUrl("docs/PI_AGENT_MODE.md#回答计划与交付")} target="_blank" rel="noreferrer">{t("Pi 交付协议")} <ArrowUpRight size={13} aria-hidden="true" /></a>
            </div>
          </div>
        </details>
        <details className="atlas-runtime-disclosure">
          <summary><span>{t("部署与访问边界")}</span><span className="atlas-disclosure-tag">{t("本机 / 可信内网")}</span><ChevronDown size={18} aria-hidden="true" /></summary>
          <div className="atlas-runtime-disclosure-body">
            <p>{t("默认部署面向本机单用户或可信内网。应用尚无完整认证、租户隔离与知识库 ACL，CORS 默认开放；对外服务需要独立加固。Pi 的来源校验与远程 token 不替代应用级认证。")}</p>
            <p>{t("一个 Pi 数据目录只允许一个宿主持锁。完整 Docker 安装使用 deploy/compose.yaml，包含网页、后端与 Pi 运行时；开发模式也支持本机 Python / Node 配合 Docker 存储服务。")}</p>
            <div className="atlas-runtime-links">
              <a className="atlas-detail-link" href={architectureSourceUrl("README.md#快速开始")} target="_blank" rel="noreferrer">{t("安装与部署")} <ArrowUpRight size={13} aria-hidden="true" /></a>
              <a className="atlas-detail-link" href={architectureSourceUrl('SECURITY.md')} target="_blank" rel="noreferrer">{t("安全说明")} <ArrowUpRight size={13} aria-hidden="true" /></a>
              <a className="atlas-detail-link" href={architectureSourceUrl("docs/MMA_ARCHITECTURE.md#运行边界")} target="_blank" rel="noreferrer">{t("运行架构")} <ArrowUpRight size={13} aria-hidden="true" /></a>
              <a className="atlas-detail-link" href={architectureSourceUrl('CONTRIBUTING.md')} target="_blank" rel="noreferrer">{t("验证与贡献")} <ArrowUpRight size={13} aria-hidden="true" /></a>
            </div>
          </div>
        </details>
      </div>
    </div>
  )
}
