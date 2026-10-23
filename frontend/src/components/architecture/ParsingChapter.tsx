import { useState } from 'react'
import * as Tabs from '@radix-ui/react-tabs'
import { ArrowUpRight, FileText, Image, Music2, Table2, Video } from 'lucide-react'
import { architectureSourceUrl } from '@/data/architectureExperience'
import './parsingChapter.css'

type Text = (zh: string, en: string) => string
type Kind = 'document' | 'table' | 'image' | 'audio' | 'video'
type Step = { title: string; body: string }
type MaterialContent = {
  title: string
  introduction: string
  steps: Step[]
  stored: string
  insightTitle: string
  insight: string
  boundary: string
  sources: { label: string; path: string }[]
}

const modalities = [
  { id: 'document', zh: '文档', en: 'Documents', icon: FileText },
  { id: 'table', zh: '表格', en: 'Tables', icon: Table2 },
  { id: 'image', zh: '图片', en: 'Images', icon: Image },
  { id: 'audio', zh: '音频', en: 'Audio', icon: Music2 },
  { id: 'video', zh: '视频', en: 'Video', icon: Video },
] as const

const waveform = [15, 27, 17, 42, 58, 32, 21, 44, 69, 37, 18, 29, 52, 73, 45, 26, 17, 31, 47, 24, 12, 20, 39, 26]

function contentFor(text: Text): Record<Kind, MaterialContent> {
  return {
    document: {
      title: text('模型决定在哪里分块，程序负责保留原文。', 'The model plans the boundaries. The program preserves the text.'),
      introduction: text('文档解析要解决两个不同的问题：先从文件中提取可读内容，再决定哪些内容应该一起被检索。Tessmora 把这两件事分开，也把“理解边界”和“写出正文”的责任分开。', 'Document ingestion has two separate jobs: extract readable content from a file, then decide which passages should be retrieved together. Tessmora separates those jobs, and separates planning boundaries from producing the actual text.'),
      steps: [
        {
          title: text('先按格式提取正文与结构', 'Extract text and structure by format'),
          body: text('PDF 按可用配置尝试 MinerU API、本地 MinerU、PaddleOCR，最后回退到 PyMuPDF。Word、演示文稿和 Markdown 有各自解析器。结果可包含正文、标题、页信息与抽取图片；文档内图片另走视觉处理，其生成图注可插回 Markdown。', 'PDF parsing tries the configured and available MinerU API, local MinerU, PaddleOCR, then PyMuPDF. Word, presentations and Markdown have their own parsers. Results can include text, headings, pages and extracted images. Embedded images are processed separately, and generated captions may be inserted into the Markdown.'),
        },
        {
          title: text('把解析文本划成不可改写的原子单元', 'Build immutable units from the parsed text'),
          body: text('分块器识别标题、段落、列表、表格和代码围栏，为连续片段分配稳定的 unit ID、字符起止位置与章节路径。超过硬上限的单个单元先做确定性切分；长文分窗口交给规划器，避免一次塞入全部内容。', 'The chunker recognizes headings, paragraphs, lists, tables and fenced code. Contiguous units receive IDs, character offsets and section paths. An oversized unit is split deterministically first; a long document is planned in bounded windows rather than sent in one request.'),
        },
        {
          title: text('模型只交出边界，Python 校验并切片', 'The model returns ranges; Python validates and slices'),
          body: text('document_chunking 路由返回起止 unit ID、简短标题与关系，不返回块正文。Python 检查 ID 是否存在、范围是否连续且完整、是否超过上限，再用 source[start:end] 物化内容，并核对拼接后等于输入文本。规划失败则降级为结构规则分块。', 'The document_chunking route returns start/end unit IDs, compact titles and relations—not chunk bodies. Python checks IDs, continuous and complete coverage, and the size ceiling. It materializes source[start:end] and verifies that concatenating the chunks reconstructs the input text. Failed plans fall back to structural rules.'),
        },
      ],
      stored: text('MinIO 保留原文件与抽取图片；text_chunks_agentic 保存正文、用于编码的 embedding_text、语义/词面向量，以及 file_id、字符区间、单元 ID、章节路径和相邻块引用。页码仅在解析结果提供可映射页范围时保留。', 'MinIO keeps the original and extracted images. text_chunks_agentic stores the passage, embedding_text, dense/sparse representations, file_id, character spans, unit IDs, section paths and neighboring chunk references. Page numbers are retained when the parser representation provides mappable page spans.'),
      insightTitle: text('让模型做选择，不让它重写证据', 'Let the model choose, without rewriting the evidence'),
      insight: text('模型可以判断“定义与解释应放在一起”，但没有修改块正文的接口。章节与标题可加入 embedding_text 帮助检索，原文片段仍独立保存。', 'The model can decide that a definition belongs with its explanation, but has no interface for rewriting the passage. Section names and titles can enrich embedding_text while the source passage stays separate.'),
      boundary: text('这里的“无损”针对分块器收到的解析文本，不代表 PDF/OCR 本身无损，也不把模型图注变成原始事实。硬上限是预算保护，不是要求每块恰好一样长。', '“Lossless” applies to the text received by the chunker. It does not guarantee lossless PDF/OCR extraction or turn generated captions into original facts. The hard ceiling is a budget guardrail, not a fixed chunk length.'),
      sources: [
        { label: text('格式解析与回退', 'Format parsers and fallback'), path: 'backend/app/modules/ingestion/parsers/factory.py#L519' },
        { label: text('规划、校验与物化', 'Planning, validation and materialization'), path: 'backend/app/modules/ingestion/splitters/agentic.py#L549' },
        { label: text('文档入库', 'Document ingestion'), path: 'backend/app/modules/ingestion/service.py#L930' },
      ],
    },
    table: {
      title: text('一行数据的含义，往往写在它上方的表头里。', 'A row gets much of its meaning from the headers above it.'),
      introduction: text('把表格当成长段落切开，会丢掉“数值属于哪一列”的关系。因此 Excel 与 CSV 使用独立分块策略：保留工作表、表头和数据行，再为不同问题准备不同粒度的入口。', 'Splitting a table like ordinary prose can lose the relationship between a value and its column. Excel and CSV use a dedicated strategy that preserves sheets, headers and rows, then creates different entry points for different questions.'),
      steps: [
        {
          title: text('先读行列，不把预览当作完整数据', 'Read the rows and columns, not just the preview'),
          body: text('解析器用 pandas 读取工作表，按格式选择 openpyxl、xlrd 或 CSV 读取器；单元格按字符串处理，空值统一为空串。每张表保留 headers、rows、行列数量与列画像。Markdown 只是有限行数的阅读预览，真正分块使用完整 rows。', 'The parser reads sheets through pandas, selecting openpyxl, xlrd or CSV handling by format. Cells are handled as strings and empty values as empty strings. Each sheet retains headers, rows, dimensions and column profiles. Markdown is a limited-row preview; chunking uses the complete rows structure.'),
        },
        {
          title: text('同时建立摘要、行块和列画像', 'Create sheet summaries, row blocks and column profiles'),
          body: text('Sheet 摘要记录表名、规模与列名；启用时，模型根据表头及少量样例行补充摘要，失败不阻塞行块入库。行块按字符预算分批，每块复制表头。列画像单独保存推断类型、非空数量、唯一值、示例值及适用的数值统计。', 'A sheet-summary chunk records its name, size and columns. When enabled, a model adds a summary from headers and sampled rows; failure does not block row ingestion. Rows are grouped by a character budget, with headers repeated in every block. Column profiles capture inferred types, non-empty/unique counts, examples and applicable numeric statistics.'),
        },
        {
          title: text('把工作表与行区间留在每块旁边', 'Keep sheet identity and row ranges with each block'),
          body: text('行块写入 sheet_name、row_start、row_end 与 excel_chunk_type，三种块都进入文本检索。行号是解析后数据行的 1-based 编号；它帮助定位数据范围，但不能直接假设等于原 Excel 界面的物理行号。', 'Row blocks include sheet_name, row_start, row_end and excel_chunk_type. All three chunk types enter text retrieval. Row positions are 1-based indexes of the parsed data rows; they identify a data range and should not automatically be treated as physical row numbers in the original Excel UI.'),
        },
      ],
      stored: text('MinIO 保存原始工作簿或 CSV。Qdrant 保存 sheet_summary、row_block、column_portrait 三类文本块及其向量、工作表信息与行/列定位；查询具体记录、寻找字段和理解整表有各自的命中入口。', 'MinIO keeps the workbook or CSV. Qdrant stores sheet_summary, row_block and column_portrait passages with vectors, sheet metadata and row/column locations. Looking up records, finding fields and understanding a sheet each have an appropriate retrieval entry point.'),
      insightTitle: text('重复表头，但不重复相邻数据', 'Repeat the headers, without overlapping the rows'),
      insight: text('表格块明确标记 no_overlap，避免通用重叠策略把表头和数据反复拼成错位表格。合并单元格留下的空值也不自动向下填充，避免程序替用户猜测归属。', 'Table chunks explicitly use no_overlap, avoiding repeated headers and rows being stitched into misaligned tables. Blank cells left by merged cells are not automatically forward-filled, so the parser does not guess their meaning.'),
      boundary: text('摘要来自样例而非逐行论证；列类型是启发式判断。检索到一个行块不等于已经完成整表统计，精确计算仍需要完整数据与明确操作。', 'A summary is based on samples, not an argument over every row; column types are inferred heuristically. Finding a row block is not the same as calculating over the complete table. Exact calculations need the full data and a specified operation.'),
      sources: [
        { label: text('表格解析与列画像', 'Table parsing and column profiles'), path: 'backend/app/modules/ingestion/parsers/factory.py#L1584' },
        { label: text('三类表格块', 'Three table chunk types'), path: 'backend/app/modules/ingestion/service.py#L2702' },
      ],
    },
    image: {
      title: text('图像的描述，与图像本身，是两种不同的线索。', 'An image description and the image itself are different clues.'),
      introduction: text('只为图片生成一段文字，会让未被描述的视觉细节消失在搜索之外。Tessmora 同时保留语言描述和视觉表示：一个帮助理解“图里讲了什么”，另一个补充“画面是什么样”。', 'A caption alone leaves undescribed visual details outside the text representation. Tessmora keeps both a language description and a visual representation: one describes what the image conveys, while the other adds visual similarity.'),
      steps: [
        {
          title: text('读取原图，确定真实媒体信息', 'Read the original image and its media properties'),
          body: text('ImageParser 读取图片尺寸、格式与色彩模式，并准备供多模态调用使用的内容。独立上传的图片与从 PDF、Word、演示文稿、Markdown 中抽取的图片都可以进入这条处理路径；原图文件单独保存。', 'ImageParser reads dimensions, format and color mode and prepares the content for a multimodal call. Standalone images and images extracted from PDF, Word, presentations or Markdown can enter this path. The image file is stored separately.'),
        },
        {
          title: text('带着上下文生成描述', 'Generate a description with its document context'),
          body: text('视觉语言模型根据图片生成 caption。对文档内图片，调用还可携带原图题与周围文字，让图表中的对象、指标和关系与所在段落对应。得到的描述再交给文本嵌入模型，形成 text_vec；这是一种派生表示，不是原文转录。', 'A vision-language model produces a caption. For embedded images, the request can also include the original caption and surrounding text, connecting chart objects, measures and relationships with the passage. The description is embedded as text_vec. This is a derived representation, not an original-text transcript.'),
        },
        {
          title: text('从原图另算一份视觉向量', 'Compute a separate visual vector from the image'),
          body: text('CLIP 接收解码后的图片内容，生成 clip_vec；它不以那段 caption 代替原图。文本和视觉两份向量进入同一个图片点，因此检索可以沿不同表示找到同一张图，返回时仍指向同一来源。', 'CLIP receives the decoded image content to produce clip_vec; it does not substitute the caption for the image. The text and visual vectors live on the same image point, allowing different representations to lead back to the same source.'),
        },
      ],
      stored: text('MinIO 保存图片。image_vectors 保存 caption、text_vec、clip_vec、尺寸、格式与来源类型；文档抽图还记录 source_file_id，必要时保留 markdown_ref，便于关联原文、预览替换和随来源文档清理。', 'MinIO stores the image. image_vectors retains caption, text_vec, clip_vec, dimensions, format and source type. Extracted images also retain source_file_id and, where available, markdown_ref for document association, preview replacement and cleanup with their source document.'),
      insightTitle: text('保留两种表示，也保留父文档身份', 'Keep both representations and the parent document identity'),
      insight: text('图注可以插回文档参与文字检索，图片又有独立的视觉索引。source_file_id 把它们联回原文件，避免一张抽取图变成没有上下文、无法随原文管理的孤立素材。', 'A generated caption can be inserted into the document for text retrieval, while the image has its own visual index. source_file_id connects it to the original, keeping extracted images manageable within their document context.'),
      boundary: text('描述可能遗漏或误读细节；CLIP 相似度也不证明两张图表达同一事实。图中文字、数值、坐标与关系需要时仍应回看原图；模型路由由实际配置决定。', 'Descriptions can omit or misread details, and CLIP similarity does not prove that two images express the same fact. Text, values, axes and relationships may still require checking the original. The actual model route depends on configuration.'),
      sources: [
        { label: text('图片元数据解析', 'Image metadata parsing'), path: 'backend/app/modules/ingestion/parsers/factory.py#L1249' },
        { label: text('描述与双向量入库', 'Caption and dual-vector ingestion'), path: 'backend/app/modules/ingestion/service.py#L1119' },
        { label: text('图片存储契约', 'Image storage schema'), path: 'backend/app/modules/ingestion/storage/vector_store.py#L81' },
      ],
    },
    audio: {
      title: text('说了什么，与听起来怎样，分别留下证据。', 'What was said and how it sounded need different representations.'),
      introduction: text('音频不只有语音：一段机器声、环境声或音乐，可能没有可转写的句子。因此入库同时处理文本线索和声学特征，不能把“音频理解”简化为一次语音转文字。', 'Audio is more than speech. Machinery, ambient sound or music may contain no sentence to transcribe. Ingestion therefore handles both text clues and acoustic features, rather than reducing audio understanding to transcription alone.'),
      steps: [
        {
          title: text('提取媒体信息，调用音频理解路由', 'Read media properties and call the audio route'),
          body: text('解析器先提取格式、时长、采样率和声道等信息。随后 audio_transcription 路由接收原始音频内容，尝试一次返回 transcript 与 description：前者记录说了什么，后者描述声音或内容。具体提供方由模型管理配置选择。', 'The parser first extracts format, duration, sample rate and channels. The audio_transcription route then receives the original audio and attempts to return transcript and description together: spoken content and a description of the audio. The provider is selected by model-manager configuration.'),
        },
        {
          title: text('区分原音频观察与文本补充描述', 'Distinguish audio observation from text-based description'),
          body: text('如果响应未包含 description，系统可基于转写再调用文本模型补充描述。这个回退没有重新聆听音频，所以不能把它对情绪、场景的推断当成直接声学观察。转写与描述拼接后，建立 text_vec 与 sparse 词面表示。', 'If description is missing, a text model may derive one from the transcript. This fallback does not listen to the audio again, so its inferences about mood or setting are not direct acoustic observations. Transcript and description are combined for text_vec and sparse lexical representations.'),
        },
        {
          title: text('从波形提取独立的 CLAP 特征', 'Extract independent CLAP features from the waveform'),
          body: text('原始音频另行解码、转为单声道并重采样，交给本地 CLAP 音频编码器，得到归一化的 clap_vec。它表示声音特征，不是 ASR，也不是由转写文字换算出来的向量；因此能为非语音声音提供另一条检索线索。', 'The original is separately decoded, converted to mono and resampled for the local CLAP audio encoder, producing a normalized clap_vec. This represents sound features. It is neither ASR nor a vector derived from the transcript, and provides another clue for non-speech audio.'),
        },
      ],
      stored: text('MinIO 保留原音频；audio_vectors 的同一文件级点保存 transcript、description、text_vec、clap_vec、sparse，以及来源路径和音频元数据。当前独立音频流程不是按句子分别建带起止时间的点。', 'MinIO keeps the audio. A file-level point in audio_vectors stores transcript, description, text_vec, clap_vec, sparse, source path and media metadata. The current standalone-audio path does not create a separate timestamped point for each sentence.'),
      insightTitle: text('文本检索与声音检索可以指向同一个文件', 'Text and acoustic searches can identify the same file'),
      insight: text('语言表示帮助查“谈到了什么”，CLAP 帮助查“是什么声音”。两种表示绑定同一来源，能互相补充，但不会把转写、推断描述和声学特征混成一种证据。', 'The language representation helps find what was discussed; CLAP helps find a kind of sound. Binding both to one source allows complementary retrieval while preserving the distinction between transcript, inferred description and acoustic features.'),
      boundary: text('转写失败时可能留下失败占位文本；CLAP 提取失败会使用零向量占位。索引记录存在不等于两路特征都有效，也不能承诺每句都有可跳转的精确时间戳。', 'A transcription failure can leave failure-placeholder text, and CLAP extraction failure uses a zero-vector placeholder. A stored point does not establish that both representations are valid, nor guarantee an exact timestamp for every sentence.'),
      sources: [
        { label: text('音频入库', 'Audio ingestion'), path: 'backend/app/modules/ingestion/service.py#L1231' },
        { label: text('转写与描述回退', 'Transcription and description fallback'), path: 'backend/app/modules/ingestion/service.py#L4103' },
        { label: text('CLAP 波形编码', 'CLAP waveform encoding'), path: 'backend/app/modules/ingestion/service.py#L3400' },
      ],
    },
    video: {
      title: text('视频先有场景与镜头，再有可以检索的时间。', 'Scenes and shots give video a searchable timeline.'),
      introduction: text('视频既有视觉连续性，也有跨镜头的语言。当前实现用 Scene–Shot–ASR 联合解析：Scene 组织上下文，Shot 成为主要检索单元，关键帧补充视觉线索，语音则保留独立表示。', 'Video contains both visual continuity and language spanning shots. The current Scene–Shot–ASR design uses scenes for context, shots as the main retrieval unit, keyframes for visual clues, and a separate representation for speech.'),
      steps: [
        {
          title: text('联合理解画面与音频', 'Analyze visuals and audio together'),
          body: text('video_parsing 路由在同次多模态调用中输出场景摘要、镜头区间、caption、ASR 状态与文本、关键帧时间。长视频按配置窗口与重叠区处理；下一窗口带上有限前文，结果转换到全局时间轴，而非把两个独立时间轴事后猜测对齐。', 'The video_parsing route returns scene summaries, shot intervals, captions, ASR status/text and keyframe times in one multimodal call. Long videos use configured windows and overlaps with bounded prior context. Results are shifted onto a global timeline instead of guessing alignment between independently generated timelines.'),
        },
        {
          title: text('把模型输出收敛成稳定结构', 'Normalize model output into a stable structure'),
          body: text('Python 规范化为 scene_shot_asr_v4：修正类型与时间边界，约束关键帧落在镜头内、去掉过近重复帧，并记录语句是否被边界截断。跨窗口只在时间重叠且描述相近时去重；随后重建连续区间，避免索引时间缝隙。', 'Python normalizes results to scene_shot_asr_v4: correcting types and time bounds, keeping keyframes within shots, deduplicating nearby frames and recording mid-sentence boundaries. Cross-window duplicates require overlapping time and similar content; continuous intervals are then rebuilt to avoid gaps in the index timeline.'),
        },
        {
          title: text('镜头存四路表示，关键帧独立编码', 'Index four shot representations and separate keyframes'),
          body: text('Shot 的 caption 与 ASR 分别建立 dense、sparse，两类内容不预先揉成一段。程序按选定时间从原视频抽帧，保存真实图片，再编码帧描述与 CLIP。帧预算优先覆盖不同镜头，避免仅取前若干帧、让后半段视频失去视觉入口。', 'Caption and ASR each receive dense and sparse representations, without being merged into one text. The program extracts actual frames at selected times, stores the images, then encodes frame descriptions and CLIP features. Frame budgeting prioritizes coverage across shots instead of only taking the first frames.'),
        },
      ],
      stored: text('MinIO 保存原视频、关键帧图片和版本化分析 JSON。video_shot_vectors 保存镜头四路向量与 scene/shot ID、起止时间、ASR 状态；video_keyframe_vectors 保存 frame_vec、clip_vec、帧时间及图片路径，并关联所属镜头。', 'MinIO stores the original, keyframe images and versioned analysis JSON. video_shot_vectors stores four shot representations plus scene/shot IDs, intervals and ASR status. video_keyframe_vectors stores frame_vec, clip_vec, timestamps and image paths linked to their shots.'),
      insightTitle: text('先确保覆盖，再增加每个镜头的细节', 'Establish coverage before adding detail to each shot'),
      insight: text('关键帧以“各镜头第一帧、再第二帧”的顺序分配预算；镜头数超过预算时沿全片均匀选取。长视频任一窗口失败会阻止写入新的检索向量，避免用不完整结果假装解析成功。', 'The budget is allocated to a first frame from each shot before adding second frames; when shots exceed the budget, selection spreads across the full timeline. A failed long-video window blocks new retrieval-vector writes, rather than presenting incomplete results as successful parsing.'),
      boundary: text('连续时间覆盖是索引结构约束，不等于逐帧看过或正确理解了所有画面。转写、画面描述与关键帧都受模型和采样限制，仍需回到原视频核对。', 'Continuous timeline coverage is an index-structure constraint, not proof that every frame was observed or understood correctly. Transcription, captions and keyframes retain model and sampling limits and may need checking against the original.'),
      sources: [
        { label: text('联合解析与索引写入', 'Joint parsing and index writes'), path: 'backend/app/modules/ingestion/service.py#L1379' },
        { label: text('时间规范化与跨窗合并', 'Time normalization and window merging'), path: 'backend/app/modules/ingestion/video_scene_shot.py' },
        { label: text('镜头与关键帧契约', 'Shot and keyframe schemas'), path: 'backend/app/modules/ingestion/storage/vector_store.py#L145' },
      ],
    },
  }
}

function Specimen({ kind, text }: { kind: Kind; text: Text }) {
  return (
    <figure className={`ps-specimen ps-specimen--${kind}`}>
      <figcaption>{text('结构示例 · 内容为虚构，仅说明表示方式，不调用模型', 'Structural example · fictional content, illustrating representations without a model call')}</figcaption>
      <div className="ps-specimen-comparison">
        <div className="ps-specimen-original">
          <h4>{text('输入内容', 'Input content')}</h4>
          {kind === 'document' && <div className="ps-document-fragment"><div className="ps-source-unit-strip" aria-hidden="true"><i /><i /><i /></div><p><span>u_0001</span><strong>{text('什么是先验？', 'What is a prior?')}</strong></p><p><span>u_0002</span>{text('先验描述看到新证据之前的判断。', 'A prior describes a belief before new evidence.')}</p><p><span>u_0003</span>{text('新证据到来后，再更新判断。', 'New evidence can then update that belief.')}</p></div>}
          {kind === 'table' && <div className="ps-demo-table-wrap"><table className="ps-demo-table"><caption>{text('实验记录 · 解析后的数据行', 'Experiment log · parsed data rows')}</caption><thead><tr><th>{text('样本', 'Sample')}</th><th>{text('温度', 'Temperature')}</th><th>{text('结果', 'Result')}</th></tr></thead><tbody><tr><td>001</td><td>22 °C</td><td>{text('通过', 'Pass')}</td></tr><tr><td>002</td><td>26 °C</td><td>{text('复查', 'Review')}</td></tr><tr><td>003</td><td>24 °C</td><td>{text('通过', 'Pass')}</td></tr></tbody></table></div>}
          {kind === 'image' && <div className="ps-image-input"><svg viewBox="0 0 240 145" role="img" aria-label={text('示意柱状图：A 为 20，B 为 35', 'Illustrative bar chart: A is 20 and B is 35')}><path d="M36 20v95h180" fill="none" stroke="currentColor" strokeWidth="1.3" /><rect x="69" y="67" width="43" height="48" fill="currentColor" opacity=".35" /><rect x="145" y="31" width="43" height="84" fill="currentColor" opacity=".65" /><text x="90" y="57">20</text><text x="166" y="21">35</text><text x="90" y="135">A</text><text x="166" y="135">B</text></svg><p>{text('原图：两个实验组的比较', 'Original: a comparison of two groups')}</p></div>}
          {kind === 'audio' && <div className="ps-audio-input"><div className="ps-waveform" aria-hidden="true">{waveform.map((height, index) => <i key={index} style={{ height }} />)}</div><p>{text('一段人声与机械背景声', 'Speech over a mechanical background sound')}</p><small>{text('独立音频文件', 'Standalone audio file')}</small></div>}
          {kind === 'video' && <div className="ps-video-input"><div className="ps-video-ruler" aria-hidden="true"><span>00:00</span><span>00:12</span><span>00:24</span></div><div className="ps-video-scene"><span>{text('场景：实验演示', 'Scene: an experiment')}</span><div><p>{text('镜头 A · 展示装置', 'Shot A · show the setup')}<small>00:00—00:12</small></p><p>{text('镜头 B · 调整阀门', 'Shot B · adjust the valve')}<small>00:12—00:24</small></p></div></div><p>{text('画面与声音共享时间轴', 'Visuals and audio share a timeline')}</p></div>}
        </div>
        <div className="ps-specimen-result">
          <h4>{text('保留下来的结构', 'The structure that remains')}</h4>
          {kind === 'document' && <><div className="ps-chunk-band"><span>u_0001</span><span>u_0002</span><span>u_0003</span></div><pre>{'{\n  "start_unit_id": "u_0001",\n  "end_unit_id": "u_0003"\n}'}</pre><p>{text('模型输出范围；正文由程序切片。', 'The model outputs a range; the program slices the text.')}</p><code className="ps-expression">text = source[start:end]</code></>}
          {kind === 'table' && <dl className="ps-field-list"><div><dt>sheet_summary</dt><dd>{text('表名、规模、列名与摘要', 'Sheet name, size, columns and summary')}</dd></div><div><dt>row_block</dt><dd>{text('表头 + 数据行 1—3', 'Headers + data rows 1–3')}</dd></div><div><dt>column_portrait</dt><dd>{text('每列类型、统计与样例', 'Types, statistics and examples per column')}</dd></div></dl>}
          {kind === 'image' && <dl className="ps-field-list"><div><dt>caption → text_vec</dt><dd>{text('“B 组柱形高于 A 组……”', '“The bar for group B is taller than A…”')}</dd></div><div><dt>{text('原图 → clip_vec', 'Image → clip_vec')}</dt><dd>{text('直接编码视觉内容', 'Encode the visual content directly')}</dd></div><div><dt>file_id / source_file_id</dt><dd>{text('图片自身与父文档身份', 'Image identity and parent-document identity')}</dd></div></dl>}
          {kind === 'audio' && <dl className="ps-field-list"><div><dt>transcript</dt><dd>{text('“请先关闭阀门。”', '“Close the valve first.”')}</dd></div><div><dt>description → text_vec</dt><dd>{text('内容描述与转写共同编码', 'Description and transcript embedded together')}</dd></div><div><dt>{text('波形 → clap_vec', 'Waveform → clap_vec')}</dt><dd>{text('独立声学表示', 'An independent acoustic representation')}</dd></div></dl>}
          {kind === 'video' && <dl className="ps-field-list"><div><dt>scene → shot</dt><dd>{text('场景上下文 + 镜头起止时间', 'Scene context + shot interval')}</dd></div><div><dt>caption / asr_text</dt><dd>{text('分别保留语义与词面表示', 'Separate semantic and lexical representations')}</dd></div><div><dt>keyframes</dt><dd>{text('实际帧图、时间与镜头关联', 'Actual frame images, times and shot links')}</dd></div></dl>}
        </div>
      </div>
    </figure>
  )
}

export function ParsingChapter({ text }: { text: Text }) {
  const [selected, setSelected] = useState<Kind>('document')
  const content = contentFor(text)

  return (
    <div className="ps-chapter">
      <p className="reading-prose ps-introduction">{text('解析的目标，不是把所有文件都压成同一种文字，而是为每种内容建立适合检索的表示，并保留它与原文件的关系。选一种材料，查看从提取内容到写入索引的具体做法。', 'Parsing does not flatten every file into the same kind of text. It builds searchable representations suited to each medium and preserves their relationship to the original. Choose a material to examine the steps from extraction to indexing.')}</p>
      <Tabs.Root value={selected} onValueChange={value => setSelected(value as Kind)}>
        <Tabs.List className="ps-modality-tabs" aria-label={text('按材料类型查看解析机制', 'Explore parsing by material type')}>
          {modalities.map(option => {
            const Icon = option.icon
            const label = text(option.zh, option.en)
            const compactLabel = option.id === 'document' ? text(option.zh, 'Docs') : label
            return <Tabs.Trigger key={option.id} value={option.id} className="ps-modality-tab" aria-label={label}><Icon size={18} strokeWidth={1.5} aria-hidden="true" /><span className={compactLabel !== label ? 'ps-modality-full-label' : undefined}>{label}</span>{compactLabel !== label && <span className="ps-modality-short-label" aria-hidden="true">{compactLabel}</span>}</Tabs.Trigger>
          })}
        </Tabs.List>
        {modalities.map(option => {
          const material = content[option.id]
          return (
            <Tabs.Content key={option.id} value={option.id} className="ps-material-panel">
              <header className="ps-material-opening"><h3>{material.title}</h3><p>{material.introduction}</p></header>
              <div className="ps-explained-spread"><Specimen kind={option.id} text={text} />
              <div className="ps-processing-reading"><ol className="ps-processing-steps">
                {material.steps.map((step, index) => <li key={index}><span className="ps-step-number" aria-hidden="true">{index + 1}</span><div><h4>{step.title}</h4><p>{step.body}</p></div></li>)}
              </ol>
              <section className="ps-storage-section"><h4>{text('最终保存什么', 'What is persisted')}</h4><p>{material.stored}</p></section>
              <aside className="ps-design-note"><h4>{material.insightTitle}</h4><p>{material.insight}</p></aside>
              <p className="ps-boundary"><strong>{text('理解这个边界', 'Keep this boundary in mind')}</strong>{material.boundary}</p>
              <nav className="reading-sources ps-sources" aria-label={text('本节源码入口', 'Source code for this section')}>
                {material.sources.map(source => <a key={source.path} className="reading-source-link" href={architectureSourceUrl(source.path)} target="_blank" rel="noreferrer">{source.label}<ArrowUpRight size={14} aria-hidden="true" /></a>)}
              </nav></div></div>
            </Tabs.Content>
          )
        })}
      </Tabs.Root>
      <p className="reading-note ps-config-note">{text('这里说明的是代码中的处理路径。解析器、模型提供方与预算取决于部署配置；图中的文本、数据与时间是教学示例，不是本次实际运行结果。', 'These are processing paths implemented in the code. Available parsers, model providers and budgets depend on deployment configuration. The text, values and times in the examples are illustrative, not results from a live run.')}</p>
    </div>
  )
}
