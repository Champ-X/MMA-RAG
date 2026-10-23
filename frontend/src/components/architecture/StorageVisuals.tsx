import { ArrowRightLeft, Database, FileText, Film, FolderOpen, HardDrive, Image, Layers, RotateCcw } from 'lucide-react'
import './storageVisuals.css'

type Props = { text: (zh: string, en: string) => string }

function VectorMarks({ variant }: { variant: 'text' | 'visual' }) {
  return <span className={`sv-vector-marks sv-vector-marks--${variant}`} aria-hidden="true">
    {Array.from({ length: 16 }, (_, index) => <i key={index} />)}
  </span>
}

export function StorageFigure({ text }: Props) {
  return <figure className="sv-figure sv-storage">
    <div className="sv-figure-topline"><span>{text('同一份资料的两个侧面', 'Two views of the same material')}</span></div>
    <div className="sv-storage-section">
      <section className="sv-object-side" aria-label={text('对象存储', 'Object storage')}>
        <div className="sv-side-title"><HardDrive size={20} aria-hidden="true" /><div><strong>MinIO</strong><span>{text('保存可以回看的材料', 'Material you can return to')}</span></div></div>
        <div className="sv-folder-label"><FolderOpen size={16} aria-hidden="true" /><code>{'kb-{kb_id}'}</code></div>
        <div className="sv-object-stack">
          <div className="sv-object-sheet sv-object-sheet--original"><FileText size={20} aria-hidden="true" /><div><strong>{text('原始文件', 'Original file')}</strong><code>{'documents/{file_id}_…'}</code></div><span className="sv-object-kind">PDF</span></div>
          <div className="sv-object-sheet"><Image size={18} aria-hidden="true" /><div><strong>{text('提取图片', 'Extracted figure')}</strong><span>{text('保留母文档身份', 'Linked to its parent document')}</span></div></div>
          <div className="sv-object-sheet"><Film size={18} aria-hidden="true" /><div><strong>{text('镜头清单 · 关键帧', 'Shot manifest · keyframes')}</strong><span>{text('视频派生物仍可独立读取', 'Readable video derivatives')}</span></div></div>
        </div>
        <p className="sv-side-footnote">{text('原件字节与解析产物', 'Original bytes and parsed artifacts')}</p>
      </section>

      <div className="sv-identity-join">
        <span className="sv-join-rule" aria-hidden="true" />
        <span>{text('共同身份', 'Shared identity')}</span>
        <code>kb_id</code><span className="sv-join-plus" aria-hidden="true">+</span><code>file_id</code>
        <span className="sv-join-rule" aria-hidden="true" />
      </div>

      <section className="sv-index-side" aria-label={text('检索索引', 'Search index')}>
        <div className="sv-side-title"><Database size={20} aria-hidden="true" /><div><strong>Qdrant</strong><span>{text('保存适合搜索的表示', 'Representations made for search')}</span></div></div>
        <div className="sv-index-record">
          <div className="sv-record-heading"><span className="sv-record-dot" aria-hidden="true" /><code>image_vectors</code><span>{text('一张图片', 'One image')}</span></div>
          <div className="sv-vector-row"><span>{text('语义', 'Semantic')}</span><VectorMarks variant="text" /><code>text_vec</code></div>
          <div className="sv-vector-row"><span>{text('视觉', 'Visual')}</span><VectorMarks variant="visual" /><code>clip_vec</code></div>
          <div className="sv-record-payload"><span>payload</span><code>file_path</code><code>source_file_id</code><code>caption</code></div>
        </div>
        <p className="sv-side-footnote">{text('图片 point 示例；其他模态有各自的向量与字段', 'An image point; other modalities have their own vectors and fields')}</p>
      </section>
    </div>
    <div className="sv-return-path"><RotateCcw size={17} aria-hidden="true" /><p><strong>{text('命中之后，沿定位回读。', 'After a match, follow its location back.')}</strong>{text(' file_path 找到对象；块位置、镜头与时间帮助找到相关部分。', ' file_path locates the object; passage, shot and time fields locate the relevant portion.')}</p></div>
    <figcaption>{text('索引回答“哪里可能相关”，对象存储提供可回看的材料。图示是结构关系，字段不代表每种模态都使用同一个 schema。', 'The index identifies possible relevance; object storage retains inspectable material. This is a structural view, not a single schema shared by every modality.')}</figcaption>
  </figure>
}

export function RuntimeFigure({ text }: Props) {
  return <figure className="sv-figure sv-runtime">
    <div className="sv-figure-topline"><span>{text('执行空间与持久化边界', 'Execution and persistence boundaries')}</span></div>
    <div className="sv-browser-connection">
      <div className="sv-browser"><div className="sv-browser-chrome" aria-hidden="true"><i /><i /><i /><span>localhost</span></div><strong>{text('浏览器', 'Browser')}</strong><span>React · {text('对话 / 资料 / 引用', 'chat / material / citations')}</span></div>
      <div className="sv-client-wire"><span>HTTP · SSE</span><i aria-hidden="true" /></div>
    </div>
    <div className="sv-service-space">
      <section className="sv-python-space" aria-label={text('Python 宿主', 'Python host')}>
        <header><span className="sv-process-dot" aria-hidden="true" /><strong>Python · FastAPI</strong><span>{text('宿主', 'host')}</span></header>
        <div className="sv-python-route"><span className="sv-route-index">A</span><div><strong>Direct / Agent</strong><p>{text('检索编排 → 上下文 → 生成', 'Retrieval → context → generation')}</p></div></div>
        <div className="sv-python-route sv-python-route--pi"><span className="sv-route-index">B</span><div><strong>{text('Pi 宿主与工具网关', 'Pi supervisor & tool gateway')}</strong><p>{text('来源约束 · 工具执行 · 事件记录', 'Source scope · tool execution · events')}</p></div></div>
      </section>
      <div className="sv-tool-wire"><span>{text('工具请求', 'Tool requests')}</span><ArrowRightLeft size={26} strokeWidth={1.4} aria-hidden="true" /><span>{text('结果 / 事件', 'Results / events')}</span></div>
      <section className="sv-node-space" aria-label={text('Node Pi 运行时', 'Node Pi runtime')}>
        <header><span className="sv-process-dot" aria-hidden="true" /><strong>Node · Pi SDK</strong></header>
        <div className="sv-loop" aria-hidden="true"><span /><i /><span /><i /><span /><i /></div>
        <strong className="sv-loop-title">{text('独立工具循环', 'Independent tool loop')}</strong>
        <p>{text('模型选择动作，读取结果后继续研究。', 'The model chooses actions, reads results and continues its investigation.')}</p>
      </section>
    </div>
    <div className="sv-persistence-label"><i aria-hidden="true" /><span>{text('由 Python 服务读取与写入', 'Read and written by Python services')}</span></div>
    <div className="sv-persistence-row">
      <div className="sv-persistence-store"><HardDrive size={18} aria-hidden="true" /><strong>MinIO</strong><span>{text('共享原件', 'Shared originals')}</span></div>
      <div className="sv-persistence-store"><Database size={18} aria-hidden="true" /><strong>Qdrant</strong><span>{text('共享索引', 'Shared indexes')}</span></div>
      <div className="sv-persistence-store sv-persistence-store--ledger"><Layers size={18} aria-hidden="true" /><strong>SQLite</strong><span>{text('Pi 运行账本', 'Pi run ledger')}</span></div>
    </div>
    <figcaption>{text('常规问答与 Pi 共用资料，通过各自的执行路径读取。Pi 的工具循环由 Node 驱动，运行账本由 Python 宿主持久化；它不经过常规 RAG 的生成链。', 'Regular answers and Pi share material through separate execution paths. Node drives Pi’s tool loop; the Python host persists its run ledger. Pi does not pass through the regular RAG generation chain.')}</figcaption>
  </figure>
}
