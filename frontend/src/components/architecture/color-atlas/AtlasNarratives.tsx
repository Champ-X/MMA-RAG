import { useEffect, useRef, useState } from 'react'
import { ArrowRight, ArrowUpRight, BookOpen, Check, ChevronDown, FileText, FolderOpen, Image as ImageIcon, Music2, Search, Table2, Video, X } from 'lucide-react'
import { architectureModes, type ArchitectureMode } from '@/data/architectureExperience'
import { AtlasSourceLink, AtlasWaveform } from './AtlasPrimitives'
import './atlasNarratives.css'

type Text = (zh: string, en: string) => string
type Props = { text: Text }
const assets = '/architecture/atlas/'

function MiniDocument({ text, image = true, compact = false }: Props & { image?: boolean; compact?: boolean }) {
  return <div className={`ca-story-mini-document ${compact ? 'ca-story-mini-document--compact' : ''}`} aria-hidden="true">
    <strong>{text('园林与空间', 'Gardens & space')}</strong>
    <p>{text('一扇漏窗可以框住四季的流转，一泓池水可以是整片江湖。', 'A window frames the changing seasons. A pool becomes a whole landscape.')}</p>
    <span /><span /><span /><span />
    {image && <img src={`${assets}concrete-architecture.webp`} alt="" width="640" height="480" loading="lazy" />}
  </div>
}

function MediaSpecimens({ text, compact = false }: Props & { compact?: boolean }) {
  return <div className={`ca-story-specimens ${compact ? 'ca-story-specimens--compact' : ''}`} aria-hidden="true">
    <MiniDocument text={text} />
    <div className="ca-story-mini-wave"><AtlasWaveform seed={4} /></div>
    <div className="ca-story-mini-film"><img src={`${assets}landscape-01.webp`} width="320" height="200" alt="" loading="lazy" /><img src={`${assets}landscape-02.webp`} width="320" height="200" alt="" loading="lazy" /></div>
  </div>
}

function VectorDots() {
  return <div className="ca-story-vector-dots" aria-hidden="true">{Array.from({ length: 70 }, (_, index) => <i key={index} style={{ opacity: .3 + ((index * 7) % 8) / 12 }} />)}</div>
}

function TinyAnswer() {
  return <div className="ca-story-tiny-answer" aria-hidden="true"><i /><i /><i /><i /><i /><i /><small>[1]</small></div>
}

function StepPaper({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return <div className="ca-story-step-paper"><h3><span>{n}</span>{title}</h3>{children}</div>
}

export function AtlasPrinciples({ text }: Props) {
  return <div className="ca-story-principles">
    <div className="ca-story-rhythm ca-story-rhythm--ingest">
      <div className="ca-story-rhythm-original"><h2>{text('资料进入时', 'When material arrives')}</h2><div className="ca-story-original-pile"><MiniDocument text={text} /><img src={`${assets}concrete-architecture.webp`} width="640" height="480" alt={text('素材空间中的混凝土建筑照片', 'Concrete architecture image from the material collection')} loading="lazy" /><img src={`${assets}botanical-study.webp`} width="400" height="500" alt={text('植物图谱', 'A botanical study')} loading="lazy" /></div></div>
      <div className="ca-story-rhythm-steps">
        <StepPaper n={1} title={text('按模态解析', 'Parse each medium')}><ul className="ca-story-modality-list"><li><FileText size={18} /><span>{text('文档块', 'Text passages')}</span></li><li><ImageIcon size={18} /><span>{text('整张图片', 'Whole images')}</span></li><li><Music2 size={18} /><span>{text('音频文件', 'Audio files')}</span></li><li><Video size={18} /><span>{text('视频镜头', 'Video shots')}</span></li></ul></StepPaper>
        <ArrowRight className="ca-story-flow-arrow" aria-hidden="true" />
        <StepPaper n={2} title={text('组织检索单元', 'Build search units')}><MediaSpecimens text={text} compact /></StepPaper>
        <ArrowRight className="ca-story-flow-arrow" aria-hidden="true" />
        <StepPaper n={3} title={text('生成表示', 'Encode meaning')}><VectorDots /><p className="ca-story-step-caption">{text('语义 · 词面 · 视觉 · 声学', 'Semantic · lexical · visual · acoustic')}</p></StepPaper>
        <ArrowRight className="ca-story-flow-arrow" aria-hidden="true" />
        <StepPaper n={4} title={text('保存索引', 'Store indexes')}><div className="ca-story-index-ledger" aria-hidden="true">{['purple', 'purple', 'green', 'orange', 'gray'].map((tone, index) => <span key={index}><i data-tone={tone} /><b /></span>)}</div><p className="ca-story-step-caption">{text('解析与编码可以复用', 'Parse once, reuse the representations')}</p></StepPaper>
      </div>
    </div>
    <div className="ca-story-rhythm ca-story-rhythm--question">
      <div className="ca-story-rhythm-original"><h2>{text('问题到来时', 'When a question arrives')}</h2><blockquote className="ca-story-question-paper">{text('园林如何组织空间？', 'How does a garden organize space?')}<span /></blockquote></div>
      <div className="ca-story-rhythm-steps">
        <StepPaper n={1} title={text('限定资料范围', 'Set source scope')}><div className="ca-story-scope-list"><span><FileText size={21} />{text('选择相关资料', 'Choose material')}</span><span><FolderOpen size={21} />{text('限定文件范围', 'Constrain files')}</span></div></StepPaper>
        <ArrowRight className="ca-story-flow-arrow" aria-hidden="true" />
        <StepPaper n={2} title={text('选择检索通道', 'Choose channels')}><div className="ca-story-channel-bars" aria-hidden="true">{[FileText, ImageIcon, Music2, Video].map((Icon, i) => <span key={i}><Icon size={17} /><b style={{ width: `${70 - i * 10}%` }} /></span>)}</div></StepPaper>
        <ArrowRight className="ca-story-flow-arrow" aria-hidden="true" />
        <StepPaper n={3} title={text('组织证据', 'Gather evidence')}><MediaSpecimens text={text} compact /></StepPaper>
        <ArrowRight className="ca-story-flow-arrow" aria-hidden="true" />
        <StepPaper n={4} title={text('生成回答', 'Compose an answer')}><TinyAnswer /><p className="ca-story-step-caption">{text('每个问题重新选择线索', 'Choose clues for each new question')}</p></StepPaper>
      </div>
    </div>
    <section className="ca-story-representations" aria-label={text('同一份资料的三种用途', 'Three uses for the same material')}>
      <div className="ca-story-representations-title"><h2>{text('同一份资料，', 'One source,')}<br />{text('三种用途。', 'three purposes.')}</h2><p>{text('搜索表示不会替代原件。', 'A search representation does not replace the original.')}</p></div>
      <div className="ca-story-representation ca-story-representation--original"><h3>{text('原件 · 回到语境', 'Original · inspect context')}</h3><div><img src={`${assets}concrete-architecture.webp`} width="640" height="480" alt={text('保留原始图像的空间、材料和光影', 'The original image retains space, material and light')} loading="lazy" /></div></div>
      <div className="ca-story-representation ca-story-representation--description"><h3>{text('描述 · 表达内容', 'Description · express content')}</h3><blockquote>{text('混凝土的曲面与光影共同构成空间。描述帮助我们寻找它，原图保留更多未被言说的细节。', 'Concrete curves and light shape the space. A description helps us find it; the image keeps the details words leave out.')}</blockquote></div>
      <div className="ca-story-representation ca-story-representation--vector"><h3>{text('向量 · 支持检索', 'Vector · enable search')}</h3><div><VectorDots /></div></div>
    </section>
    <details className="ca-story-details"><summary>{text('为什么将摄取与问答分开？', 'Why separate ingestion from answering?')}<ChevronDown size={17} /></summary><div><p>{text('摄取保留原文件，按模态形成文档块、整张图片、音频文件或视频镜头，再编码并保存索引。昂贵的解析与编码可以复用。问答在用户限定的知识库与文件中选择查询，召回、去重、重排，再组织带来源的上下文。Pi 使用同一份资料，沿独立工具路径展开研究。', 'Ingestion preserves originals and creates passages, images, audio-file units or video shots before encoding and indexing. That expensive work can be reused. Each question chooses searches within the selected knowledge bases and files, retrieves, deduplicates and reranks results, then builds source-aware context. Pi shares the material while following an independent tool path.')}</p><p>{text('描述、转写和向量都有各自的信息边界。统一结果接口，并不意味着所有模态具有相同的定位精度，也不意味着描述已被原件证实。', 'Descriptions, transcripts and vectors have different information limits. A shared result interface does not imply identical location precision across modalities, or that a description has been verified against the original.')}</p><div className="ca-story-source-links"><AtlasSourceLink path="backend/app/modules/ingestion/service.py">{text('摄取实现', 'Ingestion')}</AtlasSourceLink><AtlasSourceLink path="backend/app/modules/retrieval/service.py">{text('检索实现', 'Retrieval')}</AtlasSourceLink></div></div></details>
  </div>
}

const toolIcons = [Search, BookOpen, Video, Table2]

export function AtlasResearch({ text, mode, onModeChange }: Props & { mode: ArchitectureMode; onModeChange: (mode: ArchitectureMode) => void }) {
  const [toolIndex, setToolIndex] = useState(0)
  const tools = [
    { title: text('搜索资料', 'Search material'), body: text('先发现与问题相关的来源。搜索结果是线索，文件名本身不构成读过内容的证据。', 'Discover relevant sources first. Search results are clues; a filename is not evidence of having read the content.') },
    { title: text('阅读原文', 'Read originals'), body: text('沿来源身份展开原文，核对上下文与已有描述；读取结果成为可追溯的观察。', 'Follow a source identity into the original, inspect its context, and record a traceable observation.') },
    { title: text('观察媒体', 'Inspect media'), body: text('图片、音频与视频交给对应观察工具。观察会带来新问题，推动下一步研究。', 'Inspect images, audio and video with the appropriate tools. Observations can raise questions that guide the next step.') },
    { title: text('计算表格', 'Calculate tables'), body: text('读取工作表并计算，使用可检查的结果补充证据，而不把搜索摘要当成计算结果。', 'Read and calculate over worksheets, adding inspectable results rather than treating a search summary as a calculation.') },
  ]
  const modes = {
    direct: { title: text('一次取证，回答聚焦问题。', 'One orchestration for a focused question.'), body: text('Direct 完整执行问题分析、多路检索、去重重排与生成。一次编排内部可以有多个查询，不包含额外自主研究循环。', 'Direct performs question analysis, multi-channel retrieval, deduplication, reranking and generation. One orchestration can contain multiple queries, without an additional autonomous research loop.'), path: 'backend/app/modules/retrieval/service.py' },
    agent: { title: text('保留原题依据，再补齐缺口。', 'Keep the original evidence, then fill gaps.'), body: text('Agent 先检索原题，再在轮次、查询与证据预算内补查。已有来源范围继续约束每次检索，合并证据后进入公共生成链。', 'Agent retrieves the original question, then follows up within round, query and evidence budgets. Source scope remains binding, and merged evidence enters the shared generation path.'), path: 'backend/app/modules/agent/service.py' },
    pi: { title: text('让工具观察，推动下一步研究。', 'Let tool observations guide the next step.'), body: text('Pi 在 Node 中运行独立的工具循环，由 Python 宿主约束来源与工具访问，并记录证据。它可以搜索、深读、观察与计算，再组织交付。', 'Pi runs an independent tool loop in Node. The Python host constrains sources and tool access and records evidence. It can search, read, observe and calculate before preparing its answer.'), path: 'docs/PI_AGENT_MODE.md' },
  }
  const selected = modes[mode]
  return <div className="ca-story-research">
    <div className="ca-story-research-board">
      <section className="ca-story-rag-folder"><h2 className="ca-story-taped-title">{text('常规 RAG', 'Regular RAG')}</h2><div className="ca-story-rag-paper">
        <div className={`ca-story-rag-lane ${mode === 'direct' ? 'is-selected' : ''}`}><div className="ca-story-lane-label"><button type="button" aria-pressed={mode === 'direct'} onClick={() => onModeChange('direct')}>Direct · {text('直接检索', 'Direct retrieval')}</button><p>{text('适合问题边界清晰、已有足够资料的场景。', 'For well-scoped questions with enough material.')}</p></div><div className="ca-story-lane-flow"><span className="ca-story-question-stamp">{text('问题', 'Question')}</span><ArrowRight aria-hidden="true" /><div><MiniDocument text={text} /><small>{text('检索证据', 'Retrieve evidence')}</small></div><ArrowRight aria-hidden="true" /><div><TinyAnswer /><small>{text('组织回答', 'Compose answer')}</small></div></div></div>
        <div className={`ca-story-rag-lane ca-story-rag-lane--agent ${mode === 'agent' ? 'is-selected' : ''}`}><div className="ca-story-lane-label"><button type="button" aria-pressed={mode === 'agent'} onClick={() => onModeChange('agent')}>Agent · {text('有界补查', 'Bounded follow-up')}</button><p>{text('在既定来源范围内，发现信息缺口并补充检索。', 'Find information gaps and search within the existing source scope.')}</p></div><div className="ca-story-agent-flow"><div className="ca-story-agent-top"><span className="ca-story-question-stamp">{text('问题', 'Question')}</span><ArrowRight aria-hidden="true" /><div><MiniDocument text={text} compact /><small>{text('原题检索', 'Original search')}</small></div><ArrowRight aria-hidden="true" /><div className="ca-story-gap-note">{text('检查信息缺口', 'Check evidence gaps')}<i /></div><ArrowRight aria-hidden="true" /><TinyAnswer /></div><div className="ca-story-followup-loop"><svg viewBox="0 0 330 110" preserveAspectRatio="none" aria-hidden="true"><path d="M80 2 C0 25 5 85 85 90 M245 90 C320 75 330 28 260 2" /><path d="M73 82 86 90 71 96 M252 5 260 2 262 14" /></svg><p>{text('保持既定来源范围', 'Keep source scope')}</p><div><MiniDocument text={text} compact /><span>{text('补充检索', 'Follow-up search')}</span></div><small>{text('轮次与证据预算限制继续探索。', 'Round and evidence budgets bound exploration.')}</small></div></div></div>
      </div></section>
      <section className={`ca-story-pi-folder ${mode === 'pi' ? 'is-selected' : ''}`}><button className="ca-story-taped-title" type="button" aria-pressed={mode === 'pi'} onClick={() => onModeChange('pi')}>Pi Agent · {text('自主研究', 'Independent research')}</button><div className="ca-story-pi-paper"><p>{text('面向开放性问题，使用多种工具展开研究，从不同角度收集资料。', 'Explore open-ended questions with tools and observations from several perspectives.')}</p><div className="ca-story-tools-grid">{tools.map((tool, i) => { const Icon = toolIcons[i]; return <button key={i} type="button" className={`ca-story-tool-tile ${toolIndex === i ? 'is-active' : ''}`} aria-pressed={toolIndex === i} onClick={() => { setToolIndex(i); onModeChange('pi') }}><span><Icon size={14} />{tool.title}</span>{i < 2 ? <MiniDocument text={text} /> : i === 2 ? <div className="ca-story-tool-video"><img src={`${assets}landscape-01.webp`} width="320" height="200" alt="" loading="lazy" /><Video size={18} /></div> : <div className="ca-story-tool-table" aria-hidden="true">{Array.from({ length: 25 }, (_, j) => <i key={j}>{j % 5 === 0 ? j / 5 + 1 : j % 3 ? '' : '12.8'}</i>)}</div>}</button> })}<svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><path d="M36 20H66 M82 35V66 M65 82H35 M18 65V35" /><path d="m62 17 5 3-5 3 m17 39 3 5 3-5 m-47 17-5 3 5 3 M15 39l3-5 3 5" /></svg></div><p className="ca-story-tool-observation" aria-live="polite">{tools[toolIndex].body}</p><strong className="ca-story-independent">{text('独立研究与生成路径', 'Independent research & generation')}</strong></div></section>
    </div>
    <div className="ca-story-shared-material"><h3>{text('共享知识资料', 'Shared knowledge')}</h3><p>{text('文档、图像、音频、视频、表格，按各自的结构保留原始资料，形成可检索的表示。', 'Documents, images, audio, video and tables retain their own structures and searchable representations.')}</p><MediaSpecimens text={text} compact /><span aria-hidden="true">···</span></div>
    <section className="ca-story-mode-inspector"><div className="ca-story-mode-controls" role="group" aria-label={text('选择问答方式', 'Choose an answer approach')}>{architectureModes.map(item => <button key={item.id} type="button" aria-pressed={mode === item.id} onClick={() => onModeChange(item.id)}>{item.name}{mode === item.id && <Check size={14} aria-hidden="true" />}</button>)}</div><div aria-live="polite"><h3>{selected.title}</h3><p>{selected.body}</p><AtlasSourceLink path={selected.path}>{text('查看实现', 'View implementation')}</AtlasSourceLink></div></section>
    <div className="ca-story-research-bottom"><h2>{text('深入研究，增加的是取证动作。', 'Deeper research means more evidence gathering.')}</h2><p>{text('Auto 在 Direct 与 Agent 之间选择；Pi 单独开启。', 'Auto chooses Direct or Agent; Pi is enabled separately.')}</p></div>
    <p className="ca-story-demo-note">{text('交互为机制演示，切换不会发起模型请求。', 'Interactive mechanism demonstration; these controls do not issue model requests.')}</p>
    <details className="ca-story-details"><summary>{text('研究深度与执行边界', 'Research depth and execution boundaries')}<ChevronDown size={17} /></summary><div><p>{text('Agent 在原题检索后规划补查。合并保留原题证据额度，并为后续发现留下预算；重复查询、轮次与证据预算限制继续探索。Pi 由独立宿主管理来源范围和工具证据，默认没有应用层累计 token、总时长或工具次数上限，但存在并发槽位与运行资源限制。', 'Agent plans follow-ups after the original retrieval. Merging reserves evidence for the original question and later findings; repeated queries, rounds and evidence budgets limit exploration. Pi has an independent host for source scope and tool evidence. It has no default application-level cumulative token, time or tool-count cap, while concurrency and runtime resource limits remain.')}</p><p>{text('Pi 的 source_ids 只能收窄搜索范围。@ 引用可增加可读材料，但不自动扩大搜索权限。默认 answer plan 使用已有证据身份组织回答；身份有效不等于每一句结论都完成了语义核验。', 'Pi source_ids can only narrow search scope. @ references can add readable material without widening search permissions. The default answer plan uses existing evidence identities; a valid identity does not prove semantic support for each claim.')}</p></div></details>
  </div>
}

export function AtlasCitations({ text }: Props) {
  const [selected, setSelected] = useState<1 | 2 | null>(null)
  const source = selected === 2 ? {
    section: text('四、意境的营造 · 借景 · chunk 17', '4. Creating atmosphere · Borrowed scenery · chunk 17'),
    title: text('把天地，纳入园中。', 'Bring the landscape into the garden.'),
    before: text('借景是中国园林最富智慧的手法之一。', 'Borrowed scenery is one of the most ingenious techniques in Chinese gardens.'),
    quote: text('所谓借景，就是把园墙之外、视野所及的景物"借"入园中，拓展空间的层次与意境。', 'Borrowed scenery brings sights beyond the garden walls into the composition, extending its spatial layers and atmosphere.'),
    after: text('借景让园林突破了物理边界，把整个天地都变成了自己的一部分，也把造园者"纳千顷之汪洋，收四时之烂漫"的胸襟展露无遗。', 'Borrowed scenery reaches beyond the physical boundary, making the wider world part of the garden and expressing the maker’s desire to embrace water and the changing seasons.'),
  } : {
    section: text('四、意境的营造 · 对景与框景 · chunk 18', '4. Creating atmosphere · Framed views · chunk 18'),
    title: text('以窗为框，让风景成画。', 'Frame a view. Make a living picture.'),
    before: text('中国造园者深谙"画理"。', 'Chinese garden makers understand the art of composition.'),
    quote: text('框景则是以门洞、窗棂、廊柱为"画框"，将框内的景物裁剪成一幅天然的图画。', 'Framed views use doorways, windows and corridor columns as a picture frame, composing the scenery into a natural painting.'),
    after: text('窗外的景随人的走动而变化，一步一景，恰如展开一卷流动的山水长卷。', 'As a person moves, the scene beyond the window changes: a new view with every step, like an unfolding landscape scroll.'),
  }
  const panelRef = useRef<HTMLElement>(null)
  const citationRefs = useRef<(HTMLButtonElement | null)[]>([])
  useEffect(() => { if (selected !== null) panelRef.current?.focus({ preventScroll: true }) }, [selected])
  const openSource = (next: 1 | 2) => { setSelected(next); panelRef.current?.focus({ preventScroll: true }) }
  const close = () => { const previous = selected; setSelected(null); if (previous !== null) citationRefs.current[previous - 1]?.focus({ preventScroll: true }) }
  const citation = (n: 1 | 2) => <button type="button" className={`ca-story-citation ${selected === n ? 'is-active' : ''}`} ref={node => { citationRefs.current[n - 1] = node }} aria-label={text(`查看来源 ${n}`, `View source ${n}`)} aria-expanded={selected === n} aria-controls="ca-citation-source" onClick={() => openSource(n)}>[{n}]</button>
  const citedSentence = (zh: string, en: string, n: 1 | 2) => {
    const sentence = text(zh, en)
    const tailStart = sentence === zh ? Math.max(0, sentence.length - 3) : sentence.lastIndexOf(' ') + 1
    return <>{sentence.slice(0, tailStart)}<span className="ca-story-citation-tail">{sentence.slice(tailStart)}{citation(n)}</span></>
  }
  return <div className="ca-story-citations">
    <div className="ca-story-citation-spread">
      <section className="ca-story-answer-folder"><h2>{text('回答正文', 'The answer')}</h2><div className="ca-story-answer-paper"><div className="ca-story-answer-question">{text('园林如何运用借景与框景营造意境？', 'How do borrowed and framed views create a garden’s atmosphere?')}</div><p className="ca-story-answer-prose">{citedSentence('框景以门洞、窗棂与廊柱为画框，让景物随步移而展开。', 'Framed views use doorways, windows and columns to compose scenes that unfold as a visitor moves.', 1)}<br />{citedSentence('借景把园外风景纳入视野，让有限的园林延伸到更远处。', 'Borrowed scenery brings the landscape beyond the walls into view, extending the garden’s spatial depth.', 2)}</p><div className="ca-story-used-sources"><h3>{text('正文使用的来源', 'Sources used in the answer')}</h3><button type="button" onClick={() => openSource(1)} aria-pressed={selected === 1} aria-controls="ca-citation-source"><span>[1]</span><FileText size={19} /><span className="ca-story-source-name">{text('园林意境与哲学 · 对景与框景', 'Garden aesthetics · Framed views')}</span><ArrowRight className="ca-story-source-arrow" size={15} aria-hidden="true" /></button><button type="button" onClick={() => openSource(2)} aria-pressed={selected === 2} aria-controls="ca-citation-source"><span>[2]</span><FileText size={19} /><span className="ca-story-source-name">{text('园林意境与哲学 · 借景', 'Garden aesthetics · Borrowed scenery')}</span><ArrowRight className="ca-story-source-arrow" size={15} aria-hidden="true" /></button></div><p className="ca-story-answer-note">{text('点按正文引用，在右侧核对原文或图片。', 'Select a citation to inspect its text or image alongside the answer.')}</p></div></section>
      <section id="ca-citation-source" ref={panelRef} tabIndex={-1} onKeyDown={event => { if (event.key === 'Escape' && selected !== null) { event.preventDefault(); close() } }} className={`ca-story-source-folder ${selected ? 'is-selected' : ''}`} aria-label={text('引用来源预览', 'Citation source preview')}>
        <h2>{text('原始资料', 'Source material')}</h2>
        <div className="ca-story-source-paper">
          <header><span><FileText size={16} />{text('中国古典园林的意境与哲学.md', 'Chinese gardens.md')}</span><a href={`${assets}garden-notes.md`} target="_blank" rel="noreferrer">{text('打开原件', 'Open original')}<ArrowUpRight size={14} /></a>{selected !== null && <button type="button" onClick={close} aria-label={text('收起来源并返回引用', 'Close source and return to citation')}><X size={17} /></button>}</header>
          <div className="ca-story-source-content"><div className="ca-story-source-text"><span className="ca-story-section-label">{source.section}</span><h3>{source.title}</h3><p>{source.before}</p><blockquote><mark>{source.quote}</mark></blockquote><p>{source.after}</p></div><figure className="ca-story-source-photo"><img src={`${assets}garden.webp`} width="1000" height="700" alt={text('园林素材配图，非文档内嵌原图', 'A garden collection illustration, not an embedded image from the document')} loading="lazy" /><figcaption>{text('素材空间配图', 'Collection illustration')}</figcaption></figure></div>
        </div>
      </section>
      <svg className="ca-story-citation-connector" viewBox="0 0 1000 400" preserveAspectRatio="none" aria-hidden="true"><path d="M360 125C455 125 467 90 510 145S570 185 610 185" /><circle cx="360" cy="125" r="4" /><circle cx="610" cy="185" r="4" /></svg>
    </div>
    <div className="ca-story-evidence-bottom"><div className="ca-story-film-folder"><h3>{text('画面也保留它的来处', 'Images keep their sources too')}</h3><div><img src={`${assets}garden.webp`} width="1000" height="700" alt={text('中国园林的空间层次', 'Spatial layers in a Chinese garden')} loading="lazy" /><img src={`${assets}landscape-02.webp`} width="640" height="400" alt={text('素材空间中的自然风景', 'A landscape from the material collection')} loading="lazy" /></div></div><section className="ca-story-citation-pipeline"><h3>{text('从检索到引用', 'From retrieval to citation')}</h3><div className="ca-story-pipeline-steps"><div><h4>{text('候选材料', 'Candidates')}</h4><MiniDocument text={text} /><p>{text('多路检索找到的相关资料。', 'Related material retrieved through several channels.')}</p></div><ArrowRight aria-hidden="true" /><div><h4>{text('模型上下文', 'Model context')}</h4><MediaSpecimens text={text} compact /><p>{text('被纳入模型上下文的材料片段。', 'Material included in the model context.')}</p></div><ArrowRight aria-hidden="true" /><div><h4>{text('正文引用', 'Used citations')}</h4><div className="ca-story-cited-mini"><MiniDocument text={text} /><b>[1]</b></div><p>{text('最终出现在正文中的明确引用。', 'Explicit citations actually used in the answer.')}</p></div></div><aside><strong>{text('进入上下文，', 'In the context,')}<br />{text('不等于被正文引用。', 'is not necessarily cited.')}</strong><p>{text('引用可以定位，不代表结论已自动核验。', 'A citation locates a source; it does not automatically verify a conclusion.')}</p></aside></section></div>
    <p className="ca-story-demo-note">{text('检索样例快照 · 2026-10-25 · 风景人文：真实命中 chunk 18 与 chunk 17。回答为基于命中材料编写的引用示例；配图来自素材空间。英文节选为界面翻译，原件保留中文。', 'Retrieval snapshot · 2026-10-25 · Landscape & culture: actual hits at chunks 18 and 17. The answer is an editorial citation example based on these hits; images come from the collection. English excerpts are interface translations; the original remains Chinese.')}</p>
    <details className="ca-story-details"><summary>{text('从候选来源到实际引用', 'From candidate sources to used citations')}<ChevronDown size={17} /></summary><div><p>{text('ContextBuilder 为候选材料建立引用编号与来源映射。生成后，程序提取正文实际出现的引用，跳过代码、Markdown 链接与图片中的相似标记，按首次出现顺序保留来源。材料进入上下文、正文引用材料和结论得到语义支持，是三个不同的问题。', 'ContextBuilder maps reference IDs to candidate sources. After generation, the selector extracts citations actually used in prose, skips similar markers in code, Markdown links and images, and retains sources in first-appearance order. Inclusion in context, citation in prose and semantic support for a claim are three different questions.')}</p><p>{text('超长上下文使用粗略长度估算与截取，来源映射仍需保留。可选 Decision 检查点最多追加两段独立额度的补证，不压缩基线，也不重排已有引用编号。', 'Long context uses approximate length estimates and truncation while retaining source mappings. The optional Decision checkpoint can add up to two supplements with a separate allowance, without shrinking the baseline or renumbering its references.')}</p><div className="ca-story-source-links"><AtlasSourceLink path="backend/app/modules/generation/context_builder.py">ContextBuilder</AtlasSourceLink><AtlasSourceLink path="backend/app/modules/generation/citation_selection.py">{text('实际引用筛选', 'Used-reference selection')}</AtlasSourceLink></div></div></details>
  </div>
}
