import { ArrowUpRight, ChevronDown } from 'lucide-react'
import { architectureSourceUrl } from '@/data/architectureExperience'
import './architecturePrinciples.css'

const principles = [
  {
    title: '保全原文，再组织知识',
    summary: '分块改变阅读粒度，不替来源改写事实。',
    reason: '如果检索片段已经丢失原意，后续生成再完整也无法补回证据。因此，模型规划分块边界，服务端按原始单元物化正文。',
    mechanism: 'MinIO 保存原件与派生物，Qdrant 保存检索表示。两者以来源身份和位置连接，搜索之后仍可回到原文。',
    boundary: '这里的无损相对于解析文本成立；OCR、转写和媒体描述仍可能有误差。',
    source: 'backend/app/modules/ingestion/splitters/agentic.py', label: '原文分块实现',
  },
  {
    title: '让不同模态，保留自己的表达',
    summary: '文字能连接资料，却不能代替一张图、一段声音。',
    reason: '把所有内容压成文本会失去视觉和声学信息。常规检索按问题组合语义、词面与专用通道，既找“说了什么”，也找“看起来或听起来像什么”。',
    mechanism: 'Dense / Sparse 与 CLIP / CLAP 按需召回；视频以镜头为语义单元，关键帧补充视觉线索。转写、模型描述与媒体观察分别标记。',
    boundary: '离散关键帧与采样观察不能证明逐帧理解了完整视频。',
    source: 'docs/MULTIMODAL_IMAGE_AUDIO_VIDEO_TECHNICAL_SPEC.md', label: '多模态表示设计',
  },
  {
    title: '让研究深度，匹配问题的复杂度',
    summary: '一次取证、有界补查、自主研究，各有清晰的位置。',
    reason: '明确的问题可以直接检索；对比与综合需要追加取证；开放研究可能需要深读、查看媒体或计算表格。系统为这些任务保留不同的控制方式。',
    mechanism: 'Direct 与常规 Agent 共用检索和生成；Pi 使用独立工具循环与生成路径。它们共享资料与索引，不强行共用一条执行链。',
    boundary: '常规 Auto 只选择 Direct 或 Agent；Pi 由用户单独开启。',
    source: 'docs/PI_AGENT_MODE.md', label: '执行路径与工具协议',
  },
  {
    title: '模型负责探索，宿主守住边界',
    summary: '自主选择下一步，仍要有确定的来源、身份与记录。',
    reason: 'Agent 可以决定查什么、读什么，来源访问和证据交付却不能只靠提示词约定。Pi 宿主在工具执行和答案提交时落实这些约束。',
    mechanism: '宿主准备来源目录、校验工具范围、监督 Node 工作进程，把任务事件与证据持续写入账本。最终引用对应本次实际取得的证据。',
    boundary: '身份和编号校验不等于事实核验；回答是否被来源支持，仍需语义核对。',
    source: 'backend/app/modules/pi_agent/supervisor.py', label: 'Pi 宿主与交付校验',
  },
]

export function ArchitecturePrinciples() {
  return <div className="atlas-principles">
    <div className="atlas-principles-statement">
      <h2>先建立证据，<br />再组织答案。</h2>
      <p>检索到一段文字，只是开始。系统还要保留材料的原貌、定位与身份，让搜索可以继续深读，让结论可以回头核对。</p>
      <div className="atlas-evidence-language" aria-label="贯穿系统的证据身份">
        <div><span>来源</span><strong>它来自哪里</strong></div>
        <div><span>位置</span><strong>原文中的哪一处</strong></div>
        <div><span>类型</span><strong>原文、转写或观察</strong></div>
      </div>
      <span className="atlas-principles-note">贯穿系统的共同语言：证据</span>
    </div>
    <div className="atlas-principles-list">
      {principles.map((principle, index) => <details key={principle.title} className="atlas-principle" open={index === 0}>
        <summary><span><h3>{principle.title}</h3><span>{principle.summary}</span></span><ChevronDown size={20} aria-hidden="true" /></summary>
        <div className="atlas-principle-body"><p>{principle.reason}</p><p>{principle.mechanism}</p><p className="atlas-principle-boundary">{principle.boundary}</p><a href={architectureSourceUrl(principle.source)} target="_blank" rel="noreferrer">{principle.label}<ArrowUpRight size={14} aria-hidden="true" /></a></div>
      </details>)}
    </div>
  </div>
}
