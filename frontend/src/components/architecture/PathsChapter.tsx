import { PathFigure } from './RetrievalVisuals'
import { ArrowRight } from 'lucide-react'
import { architectureModes, type ArchitectureMode } from '@/data/architectureExperience'
import { ReadingSource } from './NarrativeChapters'

type Text = (zh: string, en: string) => string
export function PathsChapter({ text, mode, onModeChange }: { text: Text; mode: ArchitectureMode; onModeChange: (mode: ArchitectureMode) => void }) {
  const paths = {
    direct: {
      question: text('“讲义里是怎样定义贝叶斯更新的？”', '“How do the lecture notes define Bayesian updating?”'),
      title: text('一次完整的检索编排，回答一个聚焦问题', 'One retrieval orchestration for a focused question'),
      body: text('Direct 从问题分析出发，选择合适的查询和模态通道，取回候选后进行去重、重排与上下文构建，再交给公共生成链。这里的“一次”是一次完整编排，内部仍然可以并行执行多个查询和多个通道。', 'Direct analyzes the question, chooses queries and modality channels, retrieves and deduplicates candidates, reranks them, and builds context for the shared generation pipeline. One orchestration can still execute multiple queries and channels in parallel.'),
      steps: [
        [text('先确定要找什么', 'Determine what to find'), text('分析问题涉及的模态、检索意图与适用知识库。显式选择的来源范围继续作为约束，规划不会给自己扩大资料权限。', 'Analyze modalities, search intent and relevant knowledge bases. Explicit source selections remain constraints; planning does not grant itself access to more material.')],
        [text('并行获取互补线索', 'Gather complementary clues'), text('语义召回找意思相近的内容，词面召回保留型号和专名，媒体通道提供图像或声音线索。结果沿常规检索链去重、重排，再组织成带引用编号的上下文。', 'Semantic search finds related meaning, lexical search preserves model numbers and names, and media channels add visual or acoustic clues. The regular retrieval path deduplicates and reranks candidates before constructing numbered source context.')],
        [text('生成并收束引用', 'Generate and select citations'), text('模型围绕当前证据回答，最后只保留正文实际引用的来源。Direct 没有额外的自主研究循环；如果候选不足，回答的依据也就受限于这次取证。', 'The model answers from the available evidence, and final references are selected from citations actually used in prose. Direct has no separate autonomous research loop; its evidence is bounded by this retrieval pass.')],
      ],
      insight: text('适合事实定位和范围明确的问题。是否完整、是否准确，仍由资料覆盖与检索质量决定。', 'Useful for fact lookup and well-scoped questions. Completeness and accuracy still depend on source coverage and retrieval quality.'),
      source: 'backend/app/modules/retrieval/service.py',
    },
    agent: {
      question: text('“视频中的解释，与讲义的结论有什么异同？”', '“How does the video explanation compare with the lecture notes?”'),
      title: text('保留原题依据，再围绕缺口补查', 'Keep the original evidence, then investigate the gaps'),
      body: text('Agent 在常规检索链之外增加有限的规划循环。它先对原始问题做一次完整检索，再让规划器根据已有证据提出补查。各轮结果合并后，仍然进入与 Direct 相同的上下文与生成流程。', 'Agent adds a bounded planning loop around regular retrieval. It first performs a full retrieval for the original question, then plans follow-up searches from the evidence already found. Merged results ultimately enter the same context and generation pipeline as Direct.'),
      steps: [
        [text('原题先行', 'Start with the original question'), text('规划之前先检索原问题，避免改写后的查询成为唯一入口。合并时为原题证据保留一部分额度，同时给后续发现留下至少一半的证据预算。', 'Retrieve the original question before planning so rewritten queries are not the only entry point. During merging, reserve part of the evidence allowance for original-query results while leaving at least half available for later discoveries.')],
        [text('围绕信息缺口补查', 'Search for missing information'), text('比较问题可能需要另一份材料、另一种模态或相邻概念。规划器提出查询，服务层执行检索、去重并累计证据；模态覆盖不足时也可以触发定向补查。', 'A comparison may need another source, modality or related concept. The planner proposes queries; the service retrieves, deduplicates and accumulates evidence. Missing modality coverage can also trigger targeted follow-up searches.')],
        [text('把停止条件写进执行', 'Enforce stopping conditions'), text('轮次、查询数量与证据数量都有预算，重复查询与预算用尽会限制继续探索。执行记录保留查询、覆盖情况和停止原因，帮助解释“找到了什么、为何停下”。', 'Round, query and evidence budgets bound exploration, while repeated queries and exhausted allowances limit further work. Execution records preserve queries, coverage and stop reasons to explain what was found and why research ended.')],
      ],
      insight: text('原题锚点是一个防漂移设计：补查可以拓展证据，却不应把最初的问题挤出上下文。', 'The original-query anchor limits drift: follow-up research can broaden evidence without pushing the initial question out of context.'),
      source: 'backend/app/modules/agent/service.py',
    },
    pi: {
      question: text('“结合视频、讲义和实验表格，解释结果并核对计算。”', '“Use the video, notes and experiment table to explain the results and check the calculations.”'),
      title: text('让工具观察推动下一步研究', 'Let tool observations guide the next step'),
      body: text('Pi 是独立的研究与生成路径。Node 中的 Pi SDK 循环决定调用哪些工具，Python 宿主提供受约束的资料访问和证据记录。它可以搜索线索、展开原文、观察媒体、对表格计算，再根据结果继续研究，而不是只在常规检索前多加一次规划。', 'Pi is a separate research and generation path. A Pi SDK loop in Node chooses tools, while the Python host provides constrained source access and evidence recording. It can search, read originals, observe media and calculate over tables, then decide what to do next from those results.'),
      steps: [
        [text('区分发现与阅读', 'Separate discovery from reading'), text('目录和搜索结果告诉 Pi 哪里可能有资料，但文件名不等于读过内容。搜索使用原文、描述与转写的语义及词面线索；要核对原始媒体，需要继续调用观察工具。', 'Catalogues and search results identify possible sources, but a filename is not evidence of reading. Search uses semantic and lexical representations of text, descriptions and transcripts; checking original media requires further observation tools.')],
        [text('宿主掌握来源边界', 'The host enforces source boundaries'), text('工具调用携带来源身份，宿主检查知识库和文件范围。source_ids 只能收窄本次搜索；@ 引用可以作为额外可读材料，但不自动扩大搜索范围，也不能越过宿主授权。工具返回的观察和证据被记入账本。', 'Tool calls carry source identities, and the host checks knowledge-base and file scope. source_ids can only narrow the current search. @ references can add readable material without automatically widening search scope or bypassing host authorization. Tool observations and evidence enter the ledger.')],
        [text('研究与交付分开校验', 'Check research and delivery separately'), text('当前默认启用 answer plan，用已有证据身份组织交付；更细的正文单元与来源跨度验证属于默认关闭的实验能力。计划和身份有效，不代表每一句结论都已完成语义核验。', 'The default answer plan organizes delivery around existing evidence identities. Finer body-unit and source-span checks are experimental and disabled by default. Valid plans and identities do not prove semantic support for every conclusion.')],
      ],
      insight: text('Pi 默认没有应用层累计 token、总时长或工具次数上限；并发槽位与运行资源限制仍然存在。它与有明确轮次预算的 Agent 是两套不同的约束。', 'Pi has no default application-level cumulative token, total-time or tool-count cap, though concurrency slots and resource limits still apply. These are different constraints from bounded Agent rounds.'),
      source: 'docs/PI_AGENT_MODE.md',
    },
  }
  const selected = paths[mode]
  return <div className="reading-chapter">
    <p className="reading-prose reading-intro">{text('检索通道决定“用什么线索找”，执行路径决定“找到以后还要走多远”。这两层选择需要分开理解。', 'Search channels determine which clues to use. Execution paths determine how far to investigate after finding them. These are separate choices.')}</p>
    <div className="book-paths">
      <div className="book-path-options" role="group" aria-label={text('选择问答方式', 'Choose an answer approach')}>
        {architectureModes.map(item => <button key={item.id} type="button" aria-pressed={mode === item.id} onClick={() => onModeChange(item.id)}><span><strong>{item.name}</strong><small>{item.id === 'direct' ? text('聚焦问答', 'Focused answers') : item.id === 'agent' ? text('有界补查', 'Bounded follow-up') : text('自主研究', 'Independent research')}</small></span><ArrowRight size={17} aria-hidden="true" /></button>)}
      </div>
      <div className="book-path-story" key={mode}>
        <blockquote>{selected.question}</blockquote><PathFigure mode={mode} text={text} /><h3>{selected.title}</h3><p>{selected.body}</p>
        <ol className="reading-step-list">{selected.steps.map(([title, body]) => <li key={title}><h4>{title}</h4><p>{body}</p></li>)}</ol>
        <aside className="reading-insight"><p>{selected.insight}</p></aside>
        <ReadingSource path={selected.source}>{text('查看这条路径的实现', 'Inspect this implementation')}</ReadingSource>
      </div>
    </div>
    <p className="reading-note reading-note--wide">{text('Auto 只在 Direct 与 Agent 之间选择，Pi 需要单独开启。上面的切换用于解释设计，不会发起模型请求。', 'Auto chooses between Direct and Agent; Pi is enabled separately. These controls explain the design and do not issue model requests.')}</p>
  </div>
}
