import { ArrowDown, ArrowUpRight, Cpu, Database, HardDrive, Server } from 'lucide-react'
import { ArchitectureMode, architectureSourceUrl } from '@/data/architectureExperience'
import './architectureDetails.css'

export function ArchitectureRuntime({ mode }: { mode: ArchitectureMode }) {
  const isPi = mode === 'pi'

  return (
    <div className="atlas-runtime">
      <div className="atlas-section-intro">
        <div>
          <div className="atlas-eyebrow">04 / 运行与实现</div>
          <h2>执行可以独立，证据始终可追溯。</h2>
        </div>
        <p>本机 Python 与 Node 承担执行，存储服务保存原件和索引。不同路径有各自的会话与恢复边界。</p>
      </div>

      <div className="atlas-topology" aria-label="Tessmora 服务与存储拓扑">
        <div className="atlas-topology-entry">
          <div className="atlas-topology-icon"><Server size={22} strokeWidth={1.5} aria-hidden="true" /></div>
          <div><span className="atlas-detail-label">HTTP / SSE</span><h3>React 前端 → FastAPI</h3><p>请求校验、会话上下文与公开证据契约</p></div>
          <span className="atlas-topology-transport">Web · CLI · API</span>
        </div>
        <div className="atlas-topology-connect"><ArrowDown size={18} strokeWidth={1.4} aria-hidden="true" /><span>进入对应执行体系</span></div>
        <div className="atlas-execution-grid">
          <article className={`atlas-execution-node${!isPi ? ' is-selected' : ''}`}>
            <span className="atlas-detail-label">Python · 常规 RAG</span>
            <h3>Direct / 有界 Agent</h3>
            <p>共享检索编排与公共生成链，通过 SSE 返回正文、阶段与引用。</p>
            <div className="atlas-runtime-chip-row"><span>RetrievalService</span><span>GenerationService</span></div>
          </article>
          <article className={`atlas-execution-node atlas-execution-pi${isPi ? ' is-selected' : ''}`}>
            <span className="atlas-detail-label">Python 宿主 ↔ 独立 Node</span>
            <h3>Pi Agent SDK</h3>
            <p>每任务工作进程自主选择工具；宿主管理范围、执行、监督与持久事件。</p>
            <div className="atlas-runtime-chip-row"><span>受限来源工具</span><span>任务事件账本</span></div>
          </article>
        </div>
        <div className="atlas-topology-connect"><ArrowDown size={18} strokeWidth={1.4} aria-hidden="true" /><span>读取来源 · 保存产物</span></div>
        <div className="atlas-storage-grid">
          <article><HardDrive size={18} strokeWidth={1.5} aria-hidden="true" /><h4>MinIO</h4><p>原文件、解析文本与媒体派生物</p><span>共享来源</span></article>
          <article><Database size={18} strokeWidth={1.5} aria-hidden="true" /><h4>Qdrant</h4><p>多模态向量、词面索引与知识库画像</p><span>共享索引</span></article>
          <article className={isPi ? 'is-pi-store' : ''}><Database size={18} strokeWidth={1.5} aria-hidden="true" /><h4>SQLite + 本地文件</h4><p>Pi 任务、事件、证据、附件与预览</p><span>Pi 独立持久化</span></article>
          <article className="atlas-storage-optional"><Cpu size={18} strokeWidth={1.5} aria-hidden="true" /><h4>Redis / Celery</h4><p>可选任务控制；不作为在线证据来源</p><span>启动器默认不启 Celery</span></article>
        </div>
        <p className="atlas-topology-caption">推荐开发拓扑：本机 Python / Node + Docker 存储服务。此图说明职责关系。</p>
      </div>

      <div className="atlas-lifecycle">
        <div className="atlas-lifecycle-title"><span className="atlas-detail-label">持久化与恢复</span><h3>断线、停止、重启，各自意味着什么。</h3></div>
        <div className="atlas-lifecycle-columns">
          <article className={!isPi ? 'is-current-path' : ''}>
            <h4>常规 Direct / Agent</h4>
            <dl>
              <div><dt>对话保存</dt><dd>服务端会话主要在进程内；浏览器保存对话快照，支持显式恢复。</dd></div>
              <div><dt>浏览器断线</dt><dd>流式连接可能中断；本地快照用于恢复对话，不提供 Pi 式任务事件重放。</dd></div>
              <div><dt>服务重启</dt><dd>进程内会话状态丢失。快照恢复不等同于共享数据库或多副本同步。</dd></div>
            </dl>
          </article>
          <article className={isPi ? 'is-current-path' : ''}>
            <h4>Pi 任务</h4>
            <dl>
              <div><dt>任务保存</dt><dd>任务、事件与证据持续写入 SQLite 账本；附件和预览留在本地数据目录。</dd></div>
              <div><dt>浏览器断线</dt><dd>后台任务继续，刷新可按事件序号续接。用户点击停止才取消任务与工作进程。</dd></div>
              <div><dt>服务重启</dt><dd>未完成任务标为中断，不自动重放付费请求；继续提问创建关联的新运行。</dd></div>
            </dl>
          </article>
        </div>
      </div>

      <div className="atlas-runtime-boundaries">
        <details className="atlas-runtime-disclosure" open>
          <summary><span>当前路径的执行约束</span><span className="atlas-disclosure-tag">{isPi ? 'Pi Agent' : mode === 'agent' ? '有界 Agent' : 'Direct'}</span></summary>
          <div className="atlas-runtime-disclosure-body">
            {isPi ? (
              <p>Pi 默认没有应用层累计 Token、总时长或工具次数上限。并发槽位、常规对话优先级、模型上下文、服务商容量与机器资源仍约束运行；排队任务可以取消。上下文归档保留证据定位，原产物可复读。</p>
            ) : mode === 'agent' ? (
              <p>常规 Agent 在轮数、查询数和证据预算内补查，记录停止原因后进入公共生成链。auto 可按复杂度选择 Direct 或 Agent；这些预算与 Pi 的并发调度是不同机制。</p>
            ) : (
              <p>Direct 单次调用完整检索编排后进入公共生成链。范围、模态与排除约束在检索时生效；这条路径没有 Pi 的自主工具循环或持久任务账本。</p>
            )}
            <a className="atlas-detail-link" href={architectureSourceUrl(isPi ? 'docs/PI_AGENT_MODE.md#配置与资源' : 'backend/app/modules/agent/service.py')} target="_blank" rel="noreferrer">{isPi ? 'Pi 资源与配置' : '常规执行实现'} <ArrowUpRight size={13} aria-hidden="true" /></a>
          </div>
        </details>
        <details className="atlas-runtime-disclosure">
          <summary><span>Decision 与实验性检查</span><span className="atlas-disclosure-tag">默认关闭</span></summary>
          <div className="atlas-runtime-disclosure-body">
            <p>Decision 是常规链路的可选核验组件，用于来源需求核对或回答引用诊断，具有独立的失败、跳过与未覆盖记录。它不参与 Pi 编排。</p>
            <p>Pi 默认开启回答计划；正文单元与来源片段绑定的实验检查另有开关，默认关闭。引用身份检查和计划状态检查都不能证明每句话被来源蕴含。</p>
            <div className="atlas-runtime-links">
              <a className="atlas-detail-link" href={architectureSourceUrl('docs/DECISION_MODELS.md')} target="_blank" rel="noreferrer">Decision 说明 <ArrowUpRight size={13} aria-hidden="true" /></a>
              <a className="atlas-detail-link" href={architectureSourceUrl('docs/PI_AGENT_MODE.md#回答计划与交付')} target="_blank" rel="noreferrer">Pi 交付协议 <ArrowUpRight size={13} aria-hidden="true" /></a>
            </div>
          </div>
        </details>
        <details className="atlas-runtime-disclosure">
          <summary><span>部署与访问边界</span><span className="atlas-disclosure-tag">本机 / 可信内网</span></summary>
          <div className="atlas-runtime-disclosure-body">
            <p>默认部署面向本机单用户或可信内网。应用尚无完整认证、租户隔离与知识库 ACL，CORS 默认开放；对外服务需要独立加固。Pi 的来源校验与远程 token 不替代应用级认证。</p>
            <p>一个 Pi 数据目录只允许一个宿主持锁。根 Compose 不包含完整前端与 Pi Node 环境；前端构建产物需要静态服务器和 /api 代理。</p>
            <div className="atlas-runtime-links">
              <a className="atlas-detail-link" href={architectureSourceUrl('SECURITY.md')} target="_blank" rel="noreferrer">安全说明 <ArrowUpRight size={13} aria-hidden="true" /></a>
              <a className="atlas-detail-link" href={architectureSourceUrl('docs/MMA_ARCHITECTURE.md#运行边界')} target="_blank" rel="noreferrer">运行架构 <ArrowUpRight size={13} aria-hidden="true" /></a>
              <a className="atlas-detail-link" href={architectureSourceUrl('CONTRIBUTING.md')} target="_blank" rel="noreferrer">验证与贡献 <ArrowUpRight size={13} aria-hidden="true" /></a>
            </div>
          </div>
        </details>
      </div>
    </div>
  )
}
