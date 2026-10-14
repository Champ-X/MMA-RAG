import { ArrowRight, Database, ExternalLink, FileText, HardDrive } from 'lucide-react'
import type { ReactNode } from 'react'
import { architectureSourceUrl } from '@/data/architectureExperience'
import './architectureBlueprint.css'

function SourceLink({ path, children, className = '' }: { path: string; children: ReactNode; className?: string }) {
  return <a className={`atlas-blueprint-source ${className}`} href={architectureSourceUrl(path)} target="_blank" rel="noreferrer">
    {children}<ExternalLink size={12} aria-hidden="true" />
  </a>
}

function Connector() {
  return <span className="atlas-blueprint-connector" aria-hidden="true" />
}

export function ArchitectureBlueprint() {
  return <div className="atlas-blueprint">
    <figure className="atlas-blueprint-figure" aria-labelledby="atlas-blueprint-title" aria-describedby="atlas-blueprint-caption">
      <div className="atlas-blueprint-figure-heading">
        <h3 id="atlas-blueprint-title">Tessmora 系统全景</h3>
        <p>共用知识底座，分开执行职责</p>
      </div>

      <div className="atlas-blueprint-outline" role="list" aria-label="从资料到有据可查的回答">
        <div role="listitem"><strong>多模态资料</strong><span>文档 · 图片 · 声音 · 视频</span></div>
        <span className="atlas-blueprint-outline-arrow" aria-hidden="true"><ArrowRight size={20} /></span>
        <div role="listitem"><strong>知识底座</strong><span>原件 · 索引 · 来源定位</span></div>
        <span className="atlas-blueprint-outline-arrow" aria-hidden="true"><ArrowRight size={20} /></span>
        <div role="listitem"><strong>问答与研究</strong><span>常规 RAG / 独立 Pi</span></div>
        <span className="atlas-blueprint-outline-arrow" aria-hidden="true"><ArrowRight size={20} /></span>
        <div role="listitem"><strong>回答与出处</strong><span>结论 · 引用 · 过程</span></div>
      </div>

      <div className="atlas-blueprint-entry" aria-label="统一接入层">
        <p>Web 工作台 / CLI / 飞书 / 公开 API</p>
        <ArrowRight className="atlas-blueprint-entry-arrow" size={20} aria-hidden="true" />
        <div><SourceLink path="backend/app/main.py">FastAPI</SourceLink><span>请求校验、会话与范围、HTTP / SSE</span></div>
      </div>

      <div className="atlas-blueprint-execution">
        <section className="atlas-blueprint-preparation" aria-labelledby="atlas-blueprint-preparation-title">
          <div className="atlas-blueprint-lane-heading">
            <h4 id="atlas-blueprint-preparation-title">资料准备</h4>
            <p>按模态理解，形成可复用的知识。</p>
          </div>
          <ol className="atlas-blueprint-preparation-steps">
            <li><div className="atlas-blueprint-node"><SourceLink path="backend/app/modules/ingestion/parsers/factory.py">按模态解析</SourceLink><p>解析文档、图像、音频与视频，保留内容和来源位置。</p></div><Connector /></li>
            <li><div className="atlas-blueprint-node"><SourceLink path="backend/app/modules/ingestion/splitters/agentic.py">无损分块</SourceLink><p>模型规划边界，服务端从解析文本还原完整正文。</p></div><Connector /></li>
            <li><div className="atlas-blueprint-node"><SourceLink path="backend/app/modules/ingestion/service.py">编码与索引</SourceLink><p>建立语义、稀疏、视觉与声学等可检索表示。</p></div></li>
          </ol>
          <div className="atlas-blueprint-portrait"><SourceLink path="backend/app/modules/knowledge/portraits.py">知识库画像</SourceLink><p>提炼主题，为跨库路由提供线索。</p></div>
        </section>

        <section className="atlas-blueprint-rag" aria-labelledby="atlas-blueprint-rag-title">
          <div className="atlas-blueprint-lane-heading">
            <h4 id="atlas-blueprint-rag-title">常规 RAG</h4>
            <p>共享检索，按问题增加取证轮次。</p>
          </div>
          <div className="atlas-blueprint-rag-modes atlas-blueprint-node">
            <SourceLink path="backend/app/api/chat.py"><span><strong>Direct</strong><small>一次完整检索</small></span></SourceLink>
            <SourceLink path="backend/app/modules/agent/service.py"><span><strong>有界 Agent</strong><small>原题锚点，再按预算补查</small></span></SourceLink>
          </div>
          <Connector />
          <div className="atlas-blueprint-retrieval atlas-blueprint-node">
            <SourceLink path="backend/app/modules/retrieval/service.py">RetrievalService</SourceLink>
            <p>理解问题、明确范围、画像路由</p>
            <div className="atlas-blueprint-modalities" aria-label="按需多路召回"><span>Dense</span><span>Sparse</span><span>CLIP</span><span>CLAP</span><span>Video</span></div>
            <div className="atlas-blueprint-rank"><span>RRF 融合</span><ArrowRight size={14} aria-hidden="true" /><span>Cross-Encoder 精排</span></div>
          </div>
          <Connector />
          <div className="atlas-blueprint-context atlas-blueprint-node"><SourceLink path="backend/app/modules/generation/context_builder.py">上下文与引用映射</SourceLink></div>
          <Connector />
          <div className="atlas-blueprint-generation atlas-blueprint-node"><SourceLink path="backend/app/modules/generation/service.py">公共生成链</SourceLink><p>流式回答，保留实际采用的引用。</p></div>
        </section>

        <section className="atlas-blueprint-pi" aria-labelledby="atlas-blueprint-pi-title">
          <div className="atlas-blueprint-lane-heading">
            <h4 id="atlas-blueprint-pi-title">Pi Agent</h4>
            <p>独立选择工具，也独立生成答案。</p>
          </div>
          <div className="atlas-blueprint-host">
            <SourceLink path="backend/app/modules/pi_agent/supervisor.py">Python 宿主</SourceLink>
            <p>限定来源范围，监督进程并校验交付。</p>
            <div className="atlas-blueprint-pi-loop atlas-blueprint-node">
              <SourceLink path="agent-runtime/src/runtime.mjs">独立 Node 循环</SourceLink>
              <p>判断下一步，调用工具，观察结果。</p>
            </div>
            <Connector />
            <div className="atlas-blueprint-pi-tools atlas-blueprint-node">
              <SourceLink path="backend/app/modules/pi_agent/tools.py">只读来源工具</SourceLink>
              <div><span>独立搜索</span><span>原文深读</span><span>媒体查看</span><span>表格计算</span></div>
            </div>
            <p className="atlas-blueprint-pi-answer">工具结果返回循环；Pi 完成生成后，由宿主校验并交付。</p>
          </div>
        </section>
      </div>

      <div className="atlas-blueprint-foundation">
        <section className="atlas-blueprint-store-group atlas-blueprint-shared-group" aria-labelledby="atlas-blueprint-shared-title">
          <h4 id="atlas-blueprint-shared-title">共享知识存储</h4>
          <p>资料准备写入；常规 RAG 与 Pi 按来源范围读取。</p>
          <div className="atlas-blueprint-shared-stores">
            <div className="atlas-blueprint-store">
              <HardDrive size={22} strokeWidth={1.5} aria-hidden="true" />
              <div><SourceLink path="backend/app/modules/ingestion/storage/minio_adapter.py">MinIO</SourceLink><strong>原件与派生物</strong><p>原文件、解析文本、图片与关键帧。</p></div>
            </div>
            <div className="atlas-blueprint-store">
              <Database size={22} strokeWidth={1.5} aria-hidden="true" />
              <div><SourceLink path="backend/app/modules/ingestion/storage/vector_store.py">Qdrant</SourceLink><strong>索引与知识画像</strong><p>文本、向量、来源位置与主题画像。</p></div>
            </div>
          </div>
        </section>
        <section className="atlas-blueprint-store-group atlas-blueprint-ledger-group" aria-labelledby="atlas-blueprint-ledger-title">
          <h4 id="atlas-blueprint-ledger-title">Pi 运行记录</h4>
          <p>仅由 Pi 宿主持久化，不承载常规对话。</p>
          <div className="atlas-blueprint-store">
            <FileText size={22} strokeWidth={1.5} aria-hidden="true" />
            <div><SourceLink path="backend/app/modules/pi_agent/store.py">SQLite + 本地文件</SourceLink><strong>事件与证据账本</strong><p>任务状态、可续接事件与证据产物。</p></div>
          </div>
        </section>
      </div>

      <figcaption id="atlas-blueprint-caption">飞书使用 Direct，CLI 支持常规检索与有界 Agent；Pi 通过 Web 与独立 API 接入。</figcaption>
    </figure>

    <div className="atlas-blueprint-reading-notes">
      <p><strong>执行边界：</strong>Direct 与有界 Agent 共用检索和生成链；Pi 通过独立搜索网关与工具协议读取知识底座，不绕经常规 RAG 的规划与重排。</p>
      <p><strong>模型接口：</strong>解析、编码、精排与生成按任务选用模型。更换 Embedding 时，必须确保向量与既有索引兼容；不兼容时需重建索引。<SourceLink path="backend/app/core/llm/manager.py">查看模型调度</SourceLink></p>
    </div>
  </div>
}
