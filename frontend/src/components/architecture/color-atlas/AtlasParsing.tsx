import { useEffect, useRef, useState, type ReactNode } from 'react'
import * as Tabs from '@radix-ui/react-tabs'
import { ArrowDown, ArrowRight, AudioLines, ChevronDown, FileText, Film, Image as ImageIcon, Play, Table2 } from 'lucide-react'
import { AtlasPaper, AtlasSourceLink, AtlasWaveform } from './AtlasPrimitives'
import './atlasParsing.css'

type Text = (zh: string, en: string) => string
export type AtlasMaterial = 'document' | 'table' | 'image' | 'audio' | 'video'
type TextProps = { text: Text }
type Note = { title: string; body: string }
type Material = { lead: string; motto: string; boundary: string; notes: Note[]; detail: string; stored: string; sources: { path: string; label: string }[] }

const asset = (name: string) => `/architecture/atlas/${name}.webp`
const modalities = [
  { id: 'document', zh: '文档', en: 'Documents', icon: FileText },
  { id: 'table', zh: '表格', en: 'Tables', icon: Table2 },
  { id: 'image', zh: '图片', en: 'Images', icon: ImageIcon },
  { id: 'audio', zh: '音频', en: 'Audio', icon: AudioLines },
  { id: 'video', zh: '视频', en: 'Video', icon: Film },
] as const

function Folder({ title, tone = 'green', children, className = '' }: { title: string; tone?: 'green' | 'orange' | 'purple'; children: ReactNode; className?: string }) {
  return <div className={`ca-ps-folder ca-ps-folder--${tone} ${className}`}><h4>{title}</h4><div className="ca-ps-folder-content">{children}</div></div>
}

function Connections({ variant = 'three' }: { variant?: 'three' | 'two' }) {
  return <svg className={`ca-ps-connections ca-ps-connections--${variant}`} viewBox="0 0 1200 500" preserveAspectRatio="none" aria-hidden="true">
    <path d="M 465 135 C 570 135 565 85 680 85" />
    <path d="M 470 270 C 570 270 570 250 680 250" />
    {variant === 'three' && <path d="M 465 400 C 570 400 570 420 680 420" />}
    {[135, 270, ...(variant === 'three' ? [400] : [])].map(y => <circle key={y} cx={468} cy={y} r="5" />)}
    {[85, 250, ...(variant === 'three' ? [420] : [])].map(y => <circle key={y} cx={680} cy={y} r="5" />)}
  </svg>
}

function MiniTable({ text, rows = 4, selected = 0 }: TextProps & { rows?: number; selected?: number }) {
  const data = [
    [text('建筑说明', 'Architecture notes'), text('文档', 'Document'), text('空间', 'Space')],
    [text('庭院照片', 'Courtyard photo'), text('图片', 'Image'), text('采光', 'Light')],
    [text('走访录音', 'Site interview'), text('音频', 'Audio'), text('体验', 'Experience')],
    [text('施工记录', 'Construction log'), text('视频', 'Video'), text('结构', 'Structure')],
  ]
  const shown = rows === 2 ? data.slice(selected === 1 ? 2 : 0, selected === 1 ? 4 : 2) : data
  return <table className="ca-ps-table"><thead><tr><th>{text('资料', 'Material')}</th><th>{text('类型', 'Type')}</th><th>{text('主题', 'Topic')}</th></tr></thead><tbody>{shown.map((row, i) => <tr key={row[0]} className={rows === 4 && Math.floor(i / 2) === selected ? 'ca-ps-table-selected' : undefined}>{row.map((cell, j) => <td key={j}>{cell}</td>)}</tr>)}</tbody></table>
}

function Floorplan() {
  return <svg className="ca-ps-floorplan" viewBox="0 0 260 130" fill="none" aria-hidden="true"><defs><pattern id="ca-ps-plan-grid" width="13" height="13" patternUnits="userSpaceOnUse"><path d="M13 0H0V13" stroke="currentColor" opacity=".12" strokeWidth=".7" /></pattern></defs><rect width="260" height="130" fill="url(#ca-ps-plan-grid)" /><g stroke="currentColor" strokeWidth="1.3"><path d="M32 18H210V111H32Z M38 24H204V105H38Z M94 24V63H157V24 M38 69H100V105 M163 69H204 M133 69V105 M96 63H44 M116 69H142 M157 24V55" /><path d="M96 69a20 20 0 0 1 20 20 M157 55a14 14 0 0 0 14 14" strokeWidth=".6" /><path d="M23 10V119 M219 10V119 M23 13H219 M23 117H219 M13 18H230 M13 111H230" strokeWidth=".5" /></g><g fill="currentColor"><rect x="31" y="17" width="8" height="8" /><rect x="202" y="17" width="8" height="8" /><rect x="31" y="104" width="8" height="8" /><rect x="202" y="104" width="8" height="8" /></g></svg>
}

function DocumentScene({ text }: TextProps) {
  const [selected, setSelected] = useState(0)
  const labels = [text('原文片段', 'Source passage'), text('独立图片', 'Separate image'), text('结构化片段', 'Structured passage')]
  return <div className="ca-ps-scene ca-ps-document-scene">
    <Connections />
    <div className="ca-ps-source ca-ps-document-source">
      <AtlasPaper className="ca-ps-document-paper">
        <span className="ca-ps-file-label"><FileText size={14} aria-hidden="true" /> garden-notes.md</span>
        <h3>{text('园林与意境', 'Gardens & atmosphere')}</h3>
        <div className="ca-ps-document-columns"><div>
          <button className={`ca-ps-passage ${selected === 0 ? 'is-selected' : ''}`} aria-pressed={selected === 0} onClick={() => setSelected(0)}><span className="ca-ps-marker">1</span>{text('框景则是以门洞、窗棂、廊柱为“画框”，将框内的景物裁剪成一幅天然的图画。', 'Framing uses doorways, windows and colonnades as a frame, composing the view as a natural picture.')}</button>
          <p>{text('所谓借景，就是把园墙之外、视野所及的景物“借”入园中，拓展空间的层次与意境。', 'Borrowed scenery brings visible landscapes beyond the garden wall into the garden, extending its layers and atmosphere.')}</p>
        </div><button className={`ca-ps-photo-button ${selected === 1 ? 'is-selected' : ''}`} onClick={() => setSelected(1)} aria-label={text('查看独立图片示例', 'Inspect the separate image example')} aria-pressed={selected === 1}><span className="ca-ps-marker ca-ps-marker--orange">2</span><img src={asset('garden')} width="640" height="480" alt={text('园林水面与建筑的独立资料图片', 'A separate reference image of garden buildings and water')} /></button></div>
        <div className="ca-ps-document-bottom"><Floorplan /><button className={`ca-ps-table-button ${selected === 2 ? 'is-selected' : ''}`} onClick={() => setSelected(2)} aria-label={text('查看结构化片段', 'Inspect the structured passage')} aria-pressed={selected === 2}><span className="ca-ps-marker ca-ps-marker--purple">3</span><MiniTable text={text} rows={2} /></button></div>
        <a className="ca-ps-source-caption" href="/architecture/atlas/garden-notes.md" target="_blank" rel="noreferrer">{text('查看原文 · 配图与表格为结构示例', 'View source · image and table illustrate the structure')}</a>
      </AtlasPaper>
    </div>
    <div className="ca-ps-operation"><AtlasPaper className="ca-ps-operation-label"><span>{text('规划边界', 'Plan ranges')}</span><ArrowDown size={17} aria-hidden="true" /><strong>{text('按原文切片', 'Slice the source')}</strong></AtlasPaper></div>
    <div className="ca-ps-results ca-ps-document-results">
      <Folder title={labels[0]} className={selected === 0 ? 'is-selected' : ''}><AtlasPaper className="ca-ps-excerpt"><p>{text('框景则是以门洞、窗棂、廊柱为“画框”，将框内的景物裁剪成一幅天然的图画。', 'Framing uses doorways, windows and colonnades as a frame, composing the view as a natural picture.')}</p><small>{text('原文节选 · 章节：对景与框景', 'Source excerpt · section: framed views')}</small></AtlasPaper></Folder>
      <Folder title={labels[1]} tone="orange" className={selected === 1 ? 'is-selected' : ''}><figure className="ca-ps-extracted-photo"><img src={asset('garden')} width="640" height="480" alt={text('单独保存的园林图片示例', 'An example of a separately stored garden image')} /><figcaption>{text('独立资料图片 · 处理示例', 'Separate source image · processing example')}</figcaption></figure></Folder>
      <Folder title={labels[2]} tone="purple" className={selected === 2 ? 'is-selected' : ''}><AtlasPaper className="ca-ps-structured"><MiniTable text={text} rows={2} /></AtlasPaper></Folder>
    </div>
    <p className="ca-ps-selection sr-only" aria-live="polite">{text('已选择：', 'Selected: ')}{labels[selected]}</p>
  </div>
}

function TableScene({ text }: TextProps) {
  const [group, setGroup] = useState(0)
  return <div className="ca-ps-scene ca-ps-table-scene"><Connections />
    <div className="ca-ps-source ca-ps-table-source"><AtlasPaper className="ca-ps-sheet-paper"><span className="ca-ps-file-label"><Table2 size={14} aria-hidden="true" /> materials.xlsx</span><h3>{text('资料清单', 'Material inventory')}</h3><MiniTable text={text} selected={group} /><div className="ca-ps-row-controls" aria-label={text('查看数据行块', 'Inspect a row block')}><button onClick={() => setGroup(0)} aria-pressed={group === 0}>{text('数据行 1–2', 'Data rows 1–2')}</button><button onClick={() => setGroup(1)} aria-pressed={group === 1}>{text('数据行 3–4', 'Data rows 3–4')}</button></div><p className="ca-ps-sheet-name">{text('工作表：素材目录', 'Sheet: Material catalogue')}</p></AtlasPaper></div>
    <div className="ca-ps-operation"><span className="ca-ps-operation-plain">{text('保留表头', 'Keep headers')}<ArrowRight size={20} aria-hidden="true" /></span></div>
    <div className="ca-ps-results ca-ps-table-results"><Folder title={text('整表摘要', 'Sheet summary')}><AtlasPaper className="ca-ps-excerpt"><p>{text('一份包含文档、图片、音频与视频的资料清单。', 'An inventory of documents, images, audio and video.')}</p></AtlasPaper></Folder><Folder title={text('数据行块', 'Row block')} tone="purple"><AtlasPaper className="ca-ps-row-block"><MiniTable text={text} rows={2} selected={group} /><p>{text('解析行', 'Parsed rows')} {group === 0 ? '1–2' : '3–4'} <span>{text('每块保留表头', 'Headers in every block')}</span></p></AtlasPaper></Folder><Folder title={text('列画像', 'Column profile')}><AtlasPaper className="ca-ps-excerpt"><p><strong>{text('类型：', 'Type: ')}</strong>{text('文档、图片、音频、视频', 'Document, image, audio, video')}</p><p><strong>{text('主题：', 'Topic: ')}</strong>{text('空间、采光、体验、结构', 'Space, light, experience, structure')}</p></AtlasPaper></Folder></div>
  </div>
}

function ImageScene({ text }: TextProps) {
  const [representation, setRepresentation] = useState<'text' | 'visual'>('text')
  return <div className="ca-ps-scene ca-ps-image-scene"><Connections variant="two" />
    <div className="ca-ps-source ca-ps-image-source"><figure className="ca-ps-original-photo"><figcaption>{text('原图', 'Original')} · structure.png</figcaption><img src={asset('concrete-architecture')} width="900" height="700" alt={text('混凝土体块与自然光构成的建筑空间', 'An architectural space formed by concrete and natural light')} /></figure></div>
    <div className="ca-ps-operation"><span className="ca-ps-operation-plain">{text('两种表示', 'Two representations')}<ArrowRight size={20} aria-hidden="true" /></span></div>
    <div className="ca-ps-results ca-ps-image-results"><Folder title={text('图片与上下文', 'Image & context')} className={representation === 'text' ? 'is-selected' : ''}><button className="ca-ps-representation" onClick={() => setRepresentation('text')} aria-pressed={representation === 'text'}><AtlasPaper className="ca-ps-caption-paper"><span>{text('描述', 'Description')}</span><p>{text('混凝土结构围合空间，光线沿边缘进入。', 'Concrete encloses the space; light enters along its edges.')}</p></AtlasPaper><div className="ca-ps-vector-stamp"><code>text_vec</code><AtlasWaveform seed={2} /></div></button></Folder><Folder title={text('直接编码原图', 'Encode the original')} tone="purple" className={representation === 'visual' ? 'is-selected' : ''}><button className="ca-ps-representation" onClick={() => setRepresentation('visual')} aria-pressed={representation === 'visual'}><figure className="ca-ps-visual-photo"><img src={asset('concrete-architecture')} width="640" height="480" alt={text('送入 CLIP 的原始图片', 'The original image passed to CLIP')} /></figure><div className="ca-ps-vector-stamp"><strong>CLIP</strong><AtlasWaveform seed={8} /><code>clip_vec</code></div></button></Folder><p className="ca-ps-shared-point"><ImageIcon size={18} aria-hidden="true" />{text('两种表示，连接同一个图片检索单元', 'Both representations belong to the same image point')}<span>file_id</span></p></div>
    <p className="sr-only" aria-live="polite">{representation === 'text' ? text('选中语言描述表示', 'Language description selected') : text('选中原图视觉表示', 'Image representation selected')}</p>
  </div>
}

function AudioScene({ text }: TextProps) {
  const [playing, setPlaying] = useState(false)
  const [audioError, setAudioError] = useState(false)
  const audioRef = useRef<HTMLAudioElement>(null)
  useEffect(() => { const audio = audioRef.current; return () => { audio?.pause() } }, [])
  return <div className={`ca-ps-scene ca-ps-audio-scene ${playing ? 'is-playing' : ''}`}>
    <div className="ca-ps-audio-source"><figure className="ca-ps-audio-cover"><img src={asset('garden')} width="640" height="480" alt={text('园林与水面的资料配图', 'A garden and water in the reference collection')} /><figcaption>{text('声音与空间', 'Sound & space')}</figcaption></figure><AtlasPaper className="ca-ps-audio-paper"><div className="ca-ps-audio-file"><h3>{text('半山听雨.mp3', 'Listening to Rain.mp3')}</h3><span>{text('音频文件', 'Audio file')}</span></div><AtlasWaveform className="ca-ps-audio-wave" seed={5} /><audio ref={audioRef} className="ca-ps-native-audio" controls preload="metadata" src="/architecture/atlas/listening-preview.mp3" aria-label={text('半山听雨，16 秒试听', 'Listening to Rain, a 16-second preview')} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)} onError={() => { setAudioError(true); setPlaying(false) }} /><small>{text('从原文件截取 16 秒用于试听；非检索定位片段。波形为视觉示意。', 'A 16-second excerpt for listening, not a retrieved time span. The waveform is illustrative.')}</small>{audioError && <p role="status">{text('音频暂时无法播放，请稍后重试。', 'The audio is unavailable. Please try again later.')}</p>}</AtlasPaper></div>
    <div className="ca-ps-audio-paths"><Folder title={text('转写与描述', 'Transcript & description')}><AtlasPaper className="ca-ps-excerpt"><p>{text('说了什么，与是什么声音，分别留下线索。', 'What was said and what it sounded like provide different clues.')}</p><div className="ca-ps-audio-vector"><FileText size={18} aria-hidden="true" /><span>text_vec + sparse</span></div></AtlasPaper></Folder><Folder title={text('原始波形', 'Original waveform')} tone="orange"><AtlasPaper className="ca-ps-acoustic"><AtlasWaveform seed={12} /><ArrowDown size={18} aria-hidden="true" /><strong>CLAP</strong><span>{text('独立声学表示', 'Independent acoustic features')}</span></AtlasPaper></Folder></div>
    <div className="ca-ps-audio-unit"><Folder title={text('文件级检索单元', 'File-level retrieval unit')} tone="purple"><AtlasPaper className="ca-ps-audio-record"><FileText size={32} aria-hidden="true" /><h4>{text('半山听雨.mp3', 'Listening to Rain.mp3')}</h4><div><span className="ca-ps-dot ca-ps-dot--green" /><strong>{text('内容', 'Content')}</strong><p>transcript<br />description<br />text_vec · sparse</p></div><div><span className="ca-ps-dot ca-ps-dot--orange" /><strong>{text('声音', 'Sound')}</strong><p>clap_vec</p><AtlasWaveform seed={7} /></div></AtlasPaper></Folder></div>
  </div>
}

function VideoScene({ text }: TextProps) {
  const [frame, setFrame] = useState(1)
  const videoRef = useRef<HTMLVideoElement>(null)
  useEffect(() => { const video = videoRef.current; return () => { video?.pause() } }, [])
  const frames = [
    { image: 'forest-frame-1', time: '00:01', caption: text('树干与林间光线', 'Tree trunks and forest light') },
    { image: 'forest-frame-2', time: '00:04', caption: text('阳光穿过树冠', 'Sunlight through the canopy') },
    { image: 'forest-frame-3', time: '00:08', caption: text('树影与林下植被', 'Tree shadows and undergrowth') },
  ]
  const active = frames[frame]
  return <div className="ca-ps-video-scene"><div className="ca-ps-film"><div className="ca-ps-scene-ruler"><span>{text('场景 / 镜头示意 · 非实跑分割', 'Scene / shot illustration · not a detected split')}</span><span>{text('同一原片 · 00:00–00:10', 'One source excerpt · 00:00–00:10')}</span></div><div className="ca-ps-shot-strip">{frames.map((item, index) => <button key={item.time} className={index === frame ? 'is-selected' : ''} onClick={() => setFrame(index)} aria-pressed={index === frame} aria-label={`${text('关键帧', 'Keyframe')} ${index + 1}: ${item.caption}`}><span className="ca-ps-shot-images ca-ps-shot-images--single"><img src={asset(item.image)} width="640" height="360" alt="" /></span><strong>{text('关键帧', 'Keyframe')} 0{index + 1}</strong><span>{item.time}</span></button>)}</div></div>
    <div className="ca-ps-shot-detail"><div className="ca-ps-keyframes"><span className="ca-ps-paper-label">{text('镜头结构示意', 'Illustrative shot structure')} · 00:00–00:10</span><AtlasPaper className="ca-ps-keyframe-paper"><h4>{text('实际帧图 · 内部视觉证据', 'Actual frame · visual evidence within a shot')}</h4><div className="ca-ps-keyframe-single"><img src={asset(active.image)} width="640" height="360" alt={active.caption} /></div><span>{active.time} · {text('帧描述 + CLIP', 'Frame description + CLIP')}</span></AtlasPaper></div><div className="ca-ps-shot-vectors"><AtlasPaper className="ca-ps-shot-note"><h4><FileText size={15} aria-hidden="true" />{text('镜头描述', 'Shot caption')} · Dense</h4><p>{text('描述示意：阳光穿过树林，树干与植被形成层次。', 'Illustrative description: sunlight crosses the forest, creating layers of trunks and foliage.')}</p></AtlasPaper><AtlasPaper className="ca-ps-shot-note"><h4><FileText size={15} aria-hidden="true" />{text('镜头描述', 'Shot caption')} · Sparse</h4><p>{text('词面示意：树林、阳光、树干、植被、光影。', 'Illustrative terms: forest, sunlight, trunks, foliage, shadows.')}</p></AtlasPaper><AtlasPaper className="ca-ps-shot-note"><h4><AudioLines size={15} aria-hidden="true" />ASR · Dense</h4><p>{text('转写文本独立编码；无语音时不虚构对白。', 'Transcription is encoded separately; no dialogue is invented when speech is absent.')}</p></AtlasPaper><AtlasPaper className="ca-ps-shot-note"><h4><AudioLines size={15} aria-hidden="true" />ASR · Sparse</h4><p>{text('词面表示来自转写，并保留 ASR 状态。', 'Lexical features come from the transcript, with ASR status retained.')}</p></AtlasPaper></div></div>
    <details className="ca-ps-video-preview" onToggle={event => { if (!event.currentTarget.open) videoRef.current?.pause() }}><summary><Play size={15} aria-hidden="true" /><span>{text('查看真实原片预览', 'Watch the original video preview')}</span><small>{text('10 秒 · 无音轨', '10 seconds · no audio')}</small><ChevronDown size={16} aria-hidden="true" /></summary><video ref={videoRef} src="/architecture/atlas/forest-preview.mp4" poster={asset('forest-frame-1')} controls playsInline muted preload="none" width="640" height="360" aria-label={text('森林原片，10 秒无声预览', 'Forest video, a 10-second silent preview')} /></details>
    <p className="sr-only" aria-live="polite">{text('已选择关键帧', 'Selected keyframe')} {frame + 1} · {active.caption} · {active.time}</p>
  </div>
}

function materialContent(text: Text): Record<AtlasMaterial, Material> {
  return {
    document: {
      lead: text('按各自的结构理解资料。选择纸上的标记，查看保留下来的内容。', 'Read the structure of each material. Select a marker to inspect what is retained.'),
      motto: text('模型规划边界，程序切分原文。', 'The model plans. The program slices the source.'),
      boundary: text('原文保真针对解析后的文本，不等于 OCR 无损。', 'Source fidelity applies to parsed text, not to lossless OCR.'),
      notes: [
        { title: text('先解析内容', 'Extract the content'), body: text('按文件格式提取正文与结构；文档中的图片单独处理，原文件始终保留。', 'Format-specific parsers extract text and structure. Embedded images are processed separately; the original remains stored.') },
        { title: text('只让模型选边界', 'Let the model select ranges'), body: text('标题、段落、表格和代码先变成有稳定 ID 的原子单元。模型返回范围，不返回块正文。', 'Headings, paragraphs, tables and code become atomic units with stable IDs. The model returns ranges, never passage text.') },
        { title: text('校验后切原文', 'Validate, then slice'), body: text('程序检查连续覆盖与预算，按字符区间物化片段。规划失败时，退回结构规则分块。', 'The program validates coverage and budgets, then slices character spans. Failed plans fall back to structural rules.') },
      ],
      detail: text('长文按有界窗口规划；超长单元先确定性切分。模型输出 start_unit_id / end_unit_id，Python 用 source[start:end] 物化正文，并检查拼接后等于输入。章节与标题可加入 embedding_text，但不会替换正文。页码仅在解析结果提供可映射页范围时保留。', 'Long documents are planned in bounded windows; oversized units are split deterministically first. The model returns start_unit_id / end_unit_id. Python materializes source[start:end] and checks reconstruction against the input. Titles and sections can enrich embedding_text without replacing the passage. Pages are retained only when parser spans can be mapped.'),
      stored: text('text_chunks_agentic 保存原文、语义与词面表示、字符区间、单元 ID、章节路径及相邻块引用；MinIO 保存原件和抽取图片。', 'text_chunks_agentic retains source passages, dense and sparse representations, character spans, unit IDs, section paths and neighboring references. MinIO keeps originals and extracted images.'),
      sources: [{ path: 'backend/app/modules/ingestion/splitters/agentic.py', label: text('规划与原文切片', 'Planning and source slicing') }, { path: 'backend/app/modules/ingestion/parsers/factory.py', label: text('格式解析', 'Format parsing') }],
    },
    table: {
      lead: text('保留表头、数据行与列的语义。切换行块，查看同一张表的不同入口。', 'Keep the meaning of headers, rows and columns. Switch row blocks to inspect the same table.'),
      motto: text('找到一块数据，不等于完成整表计算。', 'Finding a row block is not a whole-table calculation.'),
      boundary: text('图中行号是解析后的数据行编号，不自动等于 Excel 物理行号。', 'The row numbers identify parsed data rows, not necessarily physical Excel rows.'),
      notes: [
        { title: text('按完整数据行分块', 'Split complete data rows'), body: text('分块读取完整 rows，而非有限的 Markdown 预览。每个行块重复表头，数据行不重叠。', 'Chunking uses the complete rows, not the limited Markdown preview. Each block repeats headers without overlapping rows.') },
        { title: text('保留三个入口', 'Keep three entry points'), body: text('整表摘要帮助了解主题，行块保留记录，列画像帮助识别字段及其值。', 'Sheet summaries describe the topic, row blocks retain records, and column profiles describe fields and their values.') },
        { title: text('让定位跟着内容走', 'Keep locations with content'), body: text('工作表名称、行区间与块类型一起入库；合并单元格留下的空值不会自动填充。', 'Sheet names, row spans and chunk types stay with the data. Empty merged cells are not automatically forward-filled.') },
      ],
      detail: text('Excel / CSV 通过 pandas 与对应格式读取器解析。摘要可由表头和少量样例行生成，失败不阻塞行块。列画像包含启发式类型、非空数量、唯一值、样例及适用统计。row_start / row_end 是 1-based 解析数据行，no_overlap 防止通用重叠策略拼错表格。', 'Excel and CSV are parsed with pandas and the appropriate reader. Summaries can use headers and sampled rows; failure does not block row chunks. Column profiles include inferred types, counts, unique values, examples and applicable statistics. row_start / row_end are 1-based parsed rows. no_overlap prevents generic overlap from misaligning tables.'),
      stored: text('原始工作簿保存在 MinIO；sheet_summary、row_block、column_portrait 三类文本块连同工作表与行列定位进入检索索引。', 'MinIO keeps the workbook. sheet_summary, row_block and column_portrait enter text retrieval with sheet and row/column locations.'),
      sources: [{ path: 'backend/app/modules/ingestion/parsers/factory.py', label: text('表格与列画像', 'Tables and column profiles') }, { path: 'backend/app/modules/ingestion/service.py', label: text('表格分块与入库', 'Table chunking and ingestion') }],
    },
    image: {
      lead: text('两种搜索表示，连接同一张原图。选择一种表示，查看各自的线索。', 'Two search representations lead to one original. Select either representation to inspect its clues.'),
      motto: text('描述提供线索，细节仍要回看原图。', 'Descriptions provide clues. Details live in the original.'),
      boundary: text('图片路径仍指向图片；source_file_id 用来关联抽图的母文档。', 'The image path still points to the image; source_file_id links it to its parent document.'),
      notes: [
        { title: text('读取真实图片', 'Read the original image'), body: text('独立图片和文档抽图共用处理路径，保留尺寸、格式、来源与图片文件。', 'Standalone and extracted images share a processing path that keeps dimensions, format, source and the image file.') },
        { title: text('带着上下文描述', 'Describe with context'), body: text('视觉模型可以结合图题与周围文字生成描述，再建立语言表示 text_vec。', 'A vision model can use captions and surrounding text to generate a description, which becomes text_vec.') },
        { title: text('视觉单独编码', 'Encode visual content separately'), body: text('CLIP 直接读取原图生成 clip_vec。两份向量属于同一个图片点。', 'CLIP reads the image itself to produce clip_vec. Both vectors belong to one image point.') },
      ],
      detail: text('image_vectors 中保留 caption、text_vec、clip_vec、图片属性与来源类型。文档抽图关联 source_file_id，并可保留 markdown_ref。模型图注是派生表示；CLIP 相似度不证明图中事实相同，文字、数值、坐标与关系仍需复核。', 'image_vectors retains caption, text_vec, clip_vec, image properties and source type. Extracted images link through source_file_id and may retain markdown_ref. Generated captions are derived representations. CLIP similarity is not proof of identical facts; text, values, axes and relationships may still require inspection.'),
      stored: text('MinIO 保留图片原件，Qdrant 保存同一图片的语言与视觉表示，并保留返回原图和关联母文档的身份。', 'MinIO keeps the image. Qdrant stores its language and visual representations with identities for returning to the image and linking its parent document.'),
      sources: [{ path: 'backend/app/modules/ingestion/service.py', label: text('描述与双向量入库', 'Caption and dual-vector ingestion') }, { path: 'backend/app/modules/ingestion/storage/vector_store.py', label: text('图片存储契约', 'Image storage schema') }],
    },
    audio: {
      lead: text('文本线索与声学线索，共同指向一个音频文件。', 'Textual and acoustic clues lead to the same audio file.'),
      motto: text('定位到音频文件，保留完整的听觉语境。', 'Return to the audio file, with its full listening context.'),
      boundary: text('独立音频当前是文件级索引，不承诺逐句时间定位。', 'Standalone audio is currently indexed by file, without guaranteed sentence-level timestamps.'),
      notes: [
        { title: text('理解说了什么', 'Understand the content'), body: text('音频路由接收原始声音，尝试生成 transcript 与 description，并保留媒体元数据。', 'The audio route receives the original sound and attempts to produce transcript and description while retaining media metadata.') },
        { title: text('保留声音特征', 'Retain acoustic features'), body: text('原音频解码、转单声道并重采样，交给 CLAP。声学向量不由转写文字换算。', 'Audio is decoded, mixed to mono and resampled for CLAP. Its acoustic vector is not derived from a transcript.') },
        { title: text('共同回到文件', 'Return to one file'), body: text('文本、词面与声学表示绑定同一来源，互为补充，保持各自的证据性质。', 'Text, lexical and acoustic representations share a source while preserving their distinct roles as evidence.') },
      ],
      detail: text('audio_vectors 保存 transcript、description、text_vec、sparse 与 clap_vec。若音频理解未返回描述，可由文本模型基于转写补充；此回退没有重新听音频。转写失败可能留下占位文本，CLAP 失败可留下零向量，存在索引记录不等于两路特征都有效。', 'audio_vectors stores transcript, description, text_vec, sparse and clap_vec. If a description is absent, a text model may derive one from the transcript without listening again. Failed transcription can leave placeholder text; failed CLAP extraction can leave a zero vector. An indexed record does not prove both representations are valid.'),
      stored: text('MinIO 保存原音频；Qdrant 保存文件级检索点、来源路径与媒体元数据。当前流程不把每句话分别建为带起止时间的点。', 'MinIO stores the audio. Qdrant stores a file-level point, source path and media metadata. The current path does not create a timestamped point for each sentence.'),
      sources: [{ path: 'backend/app/modules/ingestion/service.py', label: text('音频入库与 CLAP', 'Audio ingestion and CLAP') }, { path: 'backend/app/modules/ingestion/storage/vector_store.py', label: text('音频存储契约', 'Audio storage schema') }],
    },
    video: {
      lead: text('镜头是主要检索单元，关键帧保留在镜头之内。选择一帧，查看原片中的画面。', 'Shots are the main retrieval units; keyframes remain within them. Select a frame to inspect the original image.'),
      motto: text('覆盖时间轴，不代表逐帧核验。', 'Timeline coverage is not frame-by-frame verification.'),
      boundary: text('帧图来自原视频；场景、镜头与向量展示为结构示意，不是本次解析结果。', 'Frames come from the original video; scene, shot and vector layouts illustrate the structure, not a live parsing result.'),
      notes: [
        { title: text('场景组织上下文', 'Scenes provide context'), body: text('联合理解画面与音频，得到场景、镜头、转写及关键帧时间。长视频按窗口处理。', 'Joint visual and audio analysis produces scenes, shots, ASR and keyframe times. Long videos are processed in windows.') },
        { title: text('镜头保留四路表示', 'Shots retain four representations'), body: text('镜头描述和 ASR 各自编码 dense 与 sparse，起止时间跟随镜头保留。', 'Captions and ASR each receive dense and sparse representations, with the shot’s start and end times retained.') },
        { title: text('关键帧补充视觉', 'Keyframes add visual evidence'), body: text('程序按选定时间抽取真实帧图，建立描述与 CLIP 表示，并关联所属镜头。', 'The program extracts actual frames at selected times, encodes descriptions and CLIP features, and links each frame to its shot.') },
      ],
      detail: text('Python 将结果规范化为 scene_shot_asr_v4：校正时间边界、限制关键帧落在镜头内、去除过近帧，记录语句截断。跨窗口仅在时间重叠且描述相近时去重。关键帧预算优先覆盖不同镜头；任一长视频窗口失败会阻止新检索向量写入，避免把不完整解析标作成功。', 'Python normalizes scene_shot_asr_v4: correcting time bounds, keeping keyframes inside shots, deduplicating nearby frames and recording truncated sentences. Cross-window deduplication requires overlapping times and similar descriptions. Frame budgets prioritize shot coverage. A failed long-video window blocks new vector writes instead of presenting incomplete parsing as successful.'),
      stored: text('video_shot_vectors 保存镜头四路向量、scene / shot ID、起止时间与 ASR 状态；video_keyframe_vectors 保存帧时间、图片路径、描述向量与 CLIP。MinIO 保留原视频、帧图与版本化分析 JSON。', 'video_shot_vectors stores four representations, scene/shot IDs, intervals and ASR status. video_keyframe_vectors stores frame times, image paths, description vectors and CLIP. MinIO keeps the video, frame images and versioned analysis JSON.'),
      sources: [{ path: 'backend/app/modules/ingestion/video_scene_shot.py', label: text('场景、镜头与时间归一化', 'Scenes, shots and time normalization') }, { path: 'backend/app/modules/ingestion/service.py', label: text('联合解析与索引', 'Joint parsing and indexing') }],
    },
  }
}

export function AtlasParsing({ text, kind: controlledKind, onKindChange }: TextProps & { kind?: AtlasMaterial; onKindChange?: (kind: AtlasMaterial) => void }) {
  const [localKind, setLocalKind] = useState<AtlasMaterial>('document')
  const kind = controlledKind ?? localKind
  const changeKind = (value: string) => {
    const nextKind = value as AtlasMaterial
    if (onKindChange) onKindChange(nextKind)
    else setLocalKind(nextKind)
  }
  const contents = materialContent(text)
  const headings: Record<AtlasMaterial, string> = {
    document: text('把原文展开，\n让结构浮现。', 'Open the source.\nReveal the structure.'),
    table: text('让数据成块，\n让关系保留。', 'Group the data.\nKeep its meaning.'),
    image: text('描述之外，\n还有画面本身。', 'Beyond words,\nthere is the image.'),
    audio: text('听见内容，\n也听见声音。', 'Hear the content.\nHear the sound.'),
    video: text('按场景理解，\n沿镜头回看。', 'Read the scene.\nRevisit the shot.'),
  }
  return <div className="ca-ps-root"><Tabs.Root value={kind} onValueChange={changeKind}>
    <div className="ca-ps-opening"><h1 id="book-heading" className={text('', 'ca-ps-heading-en')} tabIndex={-1}>{headings[kind].split('\n').map((line, index) => <span key={index}>{line}</span>)}</h1><div className="ca-ps-opening-controls"><Tabs.List className="ca-ps-tabs" aria-label={text('按模态查看解析过程', 'Explore parsing by modality')}>{modalities.map(({ id, zh, en, icon: Icon }) => <Tabs.Trigger className="ca-ps-tab" key={id} value={id}><Icon size={22} strokeWidth={1.6} aria-hidden="true" /><span>{text(zh, en)}</span></Tabs.Trigger>)}</Tabs.List><p className="ca-ps-lead">{contents[kind].lead}</p></div></div>
    {modalities.map(({ id }) => { const content = contents[id]; return <Tabs.Content className="ca-ps-panel" key={id} value={id}>
      {id === 'document' && <DocumentScene text={text} />}{id === 'table' && <TableScene text={text} />}{id === 'image' && <ImageScene text={text} />}{id === 'audio' && <AudioScene text={text} />}{id === 'video' && <VideoScene text={text} />}
      <div className="ca-ps-takeaway"><h3>{content.motto}</h3><p>{content.boundary}</p></div>
      <div className="ca-ps-notes">{content.notes.map((note, index) => <section key={index}><span aria-hidden="true">0{index + 1}</span><h4>{note.title}</h4><p>{note.body}</p></section>)}</div>
      <details className="ca-ps-details"><summary><span>{text('实现细节与源码', 'Implementation details & source')}</span><ChevronDown size={18} aria-hidden="true" /></summary><div className="ca-ps-detail-body"><div><h4>{text('具体怎么处理', 'How the processing works')}</h4><p>{content.detail}</p></div><div><h4>{text('最终保留什么', 'What is retained')}</h4><p>{content.stored}</p></div><nav className="ca-ps-sources" aria-label={text('解析源码入口', 'Parsing source code')}>{content.sources.map(source => <AtlasSourceLink key={source.path} path={source.path}>{source.label}</AtlasSourceLink>)}</nav></div></details>
    </Tabs.Content> })}
  </Tabs.Root><p className="ca-ps-demo-note">{text('资料、画面与时间用于解释处理机制；实际解析器、模型与预算由运行配置决定。', 'Materials, images and times illustrate the processing model. Actual parsers, models and budgets depend on runtime configuration.')}</p></div>
}
