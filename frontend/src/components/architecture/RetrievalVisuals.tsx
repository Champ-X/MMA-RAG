import './retrievalVisuals.css'

type Text = (zh: string, en: string) => string
type Mode = 'direct' | 'agent' | 'pi'

function RetrievalArtwork({ name, alt }: { name: 'semantic' | 'lexical' | 'media'; alt: string }) {
  return <div className="rv-space-art"><img src={`/architecture/illustrations/retrieval-${name}.webp`} width="1536" height="1024" alt={alt} loading="lazy" decoding="async" /></div>
}

export function RetrievalFigure({ text }: { text: Text }) {
  return <figure className="rv-figure rv-retrieval-figure">
    <div className="rv-figure-topline"><span>{text('同一个问题，三种寻找证据的方式', 'One question, three ways to find evidence')}</span></div>
    <div className="rv-query-line"><span>{text('示例需求', 'Example')}</span><p>{text('ZX-17 风机异响：寻找检修说明、叶片照片与异常录音。', 'ZX-17 turbine noise: find maintenance notes, blade photos and unusual recordings.')}</p></div>
    <div className="rv-search-spaces">
      <div className="rv-search-space" data-space="meaning"><RetrievalArtwork name="semantic" alt={text('紫色透镜与丝带连接不同文档，表现用词不同但含义相关的材料。', 'A violet lens and ribbons connect distinct documents whose meanings are related.')} /><div className="rv-space-caption"><h3>{text('含义相近', 'Related meaning')}</h3><span>Dense</span><p>{text('“周期性振动”与“异响”用词不同，也可能指向相关材料。', '“Periodic vibration” may be relevant to “unusual noise,” despite different wording.')}</p></div></div>
      <div className="rv-search-space" data-space="terms"><RetrievalArtwork name="lexical" alt={text('薄荷色玻璃选区对齐三份文档中的相同词块，表现具体词项的匹配。', 'A mint glass selection aligns matching term blocks across three documents.')} /><div className="rv-space-caption"><h3>{text('用词相合', 'Shared terminology')}</h3><span>Sparse</span><p>{text('型号和专业术语提供另一组线索，帮助保留问题中的具体限定。', 'Model names and specialist terms provide another route to the specific constraints in a question.')}</p></div></div>
      <div className="rv-search-space" data-space="media"><RetrievalArtwork name="media" alt={text('立体风景图与声波各自连接独立的查询标记，表现图像和声音的不同检索空间。', 'A landscape image and sculptural waveform each connect to a separate query marker.')} /><div className="rv-space-caption"><h3>{text('视觉与声学关联', 'Visual and acoustic links')}</h3><span>CLIP · CLAP</span><p>{text('CLIP 匹配图像线索，CLAP 匹配声音线索；两者使用各自的表示空间。', 'CLIP matches visual clues; CLAP matches sounds. Each uses its own representation space.')}</p></div></div>
    </div>
    <figcaption><span className="rv-caption-rule" aria-hidden="true" />{text('插画说明不同检索视角，不代表实际向量分布或得分。相似性产生候选；是否能支持回答，还要核对内容与适用条件。', 'The illustrations explain retrieval perspectives, not actual vector distributions or scores. Similarity produces candidates; support for an answer still requires checking content and applicability.')}</figcaption>
  </figure>
}

function RetrievalMark() {
  return <svg viewBox="0 0 180 100" aria-hidden="true">
    <path className="rv-node-line" d="M23 50h23m0 0 24-26m-24 26 24 0m-24 0 24 26M95 24l25 26m-25 0h25m-25 26 25-26h30" />
    <path className="rv-query" d="m23 43 7 7-7 7-7-7Z" />
    <rect className="rv-small-node" x="70" y="16" width="25" height="16" rx="3" /><rect className="rv-small-node" x="70" y="42" width="25" height="16" rx="3" /><rect className="rv-small-node" x="70" y="68" width="25" height="16" rx="3" />
    <circle className="rv-node-solid" cx="150" cy="50" r="7" />
  </svg>
}

function PageMark({ variant }: { variant: 'context' | 'answer' | 'ledger' }) {
  return <svg viewBox="0 0 180 100" aria-hidden="true">
    <path className="rv-page-back" d="M62 17h67v70H62Z" />
    <path className="rv-page-sheet" d="M53 11h67v70H53Z" />
    {variant === 'context' ? <>
      <path className="rv-page-line" d="M78 28h30M78 36h23M78 49h30M78 57h26M78 70h20" />
      <rect className="rv-page-badge" x="62" y="24" width="9" height="14" rx="2" /><rect className="rv-page-badge" x="62" y="46" width="9" height="14" rx="2" />
    </> : variant === 'ledger' ? <>
      <path className="rv-page-line" d="M79 28h29M79 44h29M79 60h22" /><path className="rv-ledger-check" d="m62 27 3 3 7-7m-10 20 3 3 7-7m-10 20 3 3 7-7" />
      <path className="rv-ledger-ring" d="M51 24h7m-7 16h7m-7 16h7m-7 16h7" />
    </> : <>
      <path className="rv-page-line" d="M64 27h43M64 36h31M64 50h40M64 59h33M64 68h21" />
      <circle className="rv-page-citation" cx="106" cy="36" r="4" /><circle className="rv-page-citation" cx="105" cy="59" r="4" />
    </>}
  </svg>
}

function LoopMark({ bounded }: { bounded: boolean }) {
  return <svg viewBox="0 0 180 100" aria-hidden="true">
    <path className="rv-loop-track" d="M56 52a34 34 0 0 1 58-24m10 22a34 34 0 0 1-58 24" />
    <path className="rv-loop-arrow" d="m108 27 9 4-1-10m-43 57-9-4 1 10" />
    <circle className="rv-loop-node" cx="56" cy="52" r="10" /><circle className="rv-loop-node" cx="124" cy="50" r="10" />
    <path className="rv-loop-node-detail" d="M52 52h8m-4-4v8M120 47h8m-8 4h8m-8 4h5" />
    {bounded ? <><path className="rv-loop-limit" d="M80 43h20v15H80Z" /><path className="rv-loop-limit-line" d="M85 47v7m5-7v7m5-7v7" /></> : <><circle className="rv-node-solid" cx="90" cy="17" r="4" /><circle className="rv-node-solid" cx="90" cy="85" r="4" /></>}
  </svg>
}

export function PathFigure({ text, mode }: { text: Text; mode: Mode }) {
  const stages = mode === 'direct' ? [
    { title: text('完整检索编排', 'Retrieve'), detail: text('多查询、多通道可并行', 'Queries and channels can run in parallel'), art: <RetrievalMark /> },
    { title: text('构建上下文', 'Build context'), detail: text('候选整理为编号证据', 'Organize selected material with source IDs'), art: <PageMark variant="context" /> },
    { title: text('公共生成', 'Shared generation'), detail: text('回答并保留实际引用', 'Answer and retain the citations used'), art: <PageMark variant="answer" /> },
  ] : mode === 'agent' ? [
    { title: text('原题先检索', 'Original query first'), detail: text('为初始问题建立证据锚点', 'Establish an evidence anchor for the question'), art: <RetrievalMark /> },
    { title: text('有限补查循环', 'Bounded follow-up'), detail: text('规划、检索、检查缺口', 'Plan, retrieve and check coverage'), art: <LoopMark bounded /> },
    { title: text('合并后共同生成', 'Merge, then generate'), detail: text('回到公共上下文与生成链', 'Return to shared context and generation'), art: <PageMark variant="context" /> },
  ] : [
    { title: text('独立工具循环', 'Independent tool loop'), detail: text('搜索、阅读、观察、计算', 'Search, read, inspect and calculate'), art: <LoopMark bounded={false} /> },
    { title: text('逐次记录观察', 'Record each observation'), detail: text('宿主检查范围与来源身份', 'The host checks scope and source identity'), art: <PageMark variant="ledger" /> },
    { title: text('自主组织交付', 'Produce its own answer'), detail: text('Pi 依据研究结果形成回答', 'Pi composes an answer from its research'), art: <PageMark variant="answer" /> },
  ]

  return <figure className="rv-figure rv-path-figure" data-mode={mode}>
    <div className="rv-figure-topline"><span>{text('执行结构', 'Execution structure')}</span><b>{mode === 'pi' ? 'Pi' : mode === 'agent' ? 'Agent' : 'Direct'}</b></div>
    <ol className="rv-path-track">{stages.map((stage, i) => <li key={stage.title} data-stage={i}><div className="rv-path-art">{stage.art}</div><div className="rv-path-label"><strong>{stage.title}</strong><span>{stage.detail}</span></div></li>)}</ol>
    {mode === 'agent' && <div className="rv-anchor-bridge"><span>{text('合并时保留原题证据，让补查有锚点', 'Original-query evidence stays anchored in the final merge')}</span></div>}
    <figcaption>{mode === 'direct' ? text('“一次”指完整编排，不是一次向量查询。它不再额外开启自主补查循环。', 'One orchestration is more than one vector query. Direct adds no autonomous follow-up loop.') : mode === 'agent' ? text('补查受轮次、查询数与证据预算约束；最后仍使用常规生成链。', 'Rounds, query count and evidence budgets constrain follow-up; the final answer uses the regular generation pipeline.') : text('工具结果驱动下一步行动。Pi 使用独立研究与生成路径，不经过常规检索的意图规划、路由和重排。', 'Tool results guide the next action. Pi has its own research and generation path, separate from regular intent planning, routing and reranking.')}</figcaption>
  </figure>
}
