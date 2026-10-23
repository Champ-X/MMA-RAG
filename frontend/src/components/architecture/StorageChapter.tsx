import { StorageFigure } from './StorageVisuals'
import { useId } from 'react'
import { ArrowUpRight } from 'lucide-react'
import { architectureSourceUrl } from '@/data/architectureExperience'
import './storageChapter.css'

type StorageChapterProps = { text: (zh: string, en: string) => string }

function StorageSource({ path, children }: { path: string; children: React.ReactNode }) {
  return <a className="reading-source-link" href={architectureSourceUrl(path)} target="_blank" rel="noreferrer">{children}<ArrowUpRight size={13} aria-hidden="true" /></a>
}

export function StorageChapter({ text }: StorageChapterProps) {
  const id = useId()
  const schemaCaption = `${id}-schema`
  const rolesCaption = `${id}-roles`
  const collections = [
    {
      name: 'text_chunks_agentic', unit: text('文档原文块', 'Document passage'),
      vectors: ['dense · 4096', 'sparse · indices / values'],
      fields: ['text_content', 'embedding_text', 'chunk_index', 'context_window', 'metadata'],
    },
    {
      name: 'image_vectors', unit: text('独立图片或文档提取图', 'Image or extracted document figure'),
      vectors: ['text_vec · 4096', 'clip_vec · 768'],
      fields: ['caption', 'image_source_type', 'source_file_id', 'markdown_ref'],
    },
    {
      name: 'audio_vectors', unit: text('独立音频文件', 'Standalone audio file'),
      vectors: ['text_vec · 4096', 'clap_vec · 512', 'sparse · indices / values'],
      fields: ['transcript', 'description', 'duration', 'source_type'],
    },
    {
      name: 'video_shot_vectors', unit: text('视频镜头（Shot）', 'Video shot'),
      vectors: ['caption_dense · 4096', 'asr_dense · 4096', 'caption_sparse', 'asr_sparse'],
      fields: ['scene_id', 'shot_id', 'shot_start_time', 'shot_end_time', 'caption', 'asr_text', 'manifest_path'],
    },
    {
      name: 'video_keyframe_vectors', unit: text('从属于镜头的关键帧', 'Keyframe belonging to a shot'),
      vectors: ['frame_vec · 4096', 'clip_vec · 768'],
      fields: ['shot_id', 'frame_timestamp', 'frame_image_path', 'frame_description'],
    },
    {
      name: 'kb_portraits', unit: text('知识库主题画像', 'Knowledge-base topic portrait'),
      vectors: [text('未命名稠密向量 · 4096', 'Unnamed dense vector · 4096')],
      fields: ['topic_summary', 'cluster_size', 'kb_id'],
    },
  ]

  return <div className="st-chapter"><StorageFigure text={text} />
    <p className="reading-prose">{text('一次检索返回的不是原文件本身，而是某个可搜索的表示。Tessmora 因此分别保存“资料是什么”“怎样找到它”“找到后回到哪里”：MinIO 留住文件，Qdrant 保存向量与文本载荷，来源字段把两者接起来。原文件上传成功和索引就绪，是两个需要分别确认的事实。', 'A search returns a searchable representation, rather than the original file itself. Tessmora separates what the material is, how to find it, and where a match leads back to: MinIO keeps files, Qdrant holds vectors and text payloads, and source fields connect them. A successful file upload and a ready search index are two separate facts.')}</p>

    <section className="reading-section">
      <h2 className="reading-subhead">{text('原件和派生物，共处一个知识库桶', 'Originals and derivatives share a knowledge-base bucket')}</h2>
      <div className="reading-prose">
        <p>{text('MinIO 适配器采用一库一桶，规范名称是 kb-{规范化的知识库 ID}。桶内按 documents、images、audios、videos 区分对象类型，主文件名由 UUID file_id 与原文件名组合。读取时还会解析历史桶名，以兼容已有数据，而不是在读目录时迁移文件。', 'The MinIO adapter uses one bucket per knowledge base, canonically named kb-{normalized knowledge-base ID}. The documents, images, audios and videos prefixes distinguish object types; each primary object combines a UUID file_id with the original filename. Reads also resolve historical bucket names so existing data can be located without migrating it while listing the catalog.')}</p>
        <p>{text('这里不仅存原件。文档解析出的图片也会成为对象，并通过 source_file_id 关联母文档；视频还保留 Scene–Shot 分析清单与关键帧。它们服务于预览、复核和后续读取。临时预签名 URL 是访问方式，稳定的 bucket 与 object_path 才是对象位置。', 'The bucket also holds derived material. Extracted document images become objects linked to their parent through source_file_id; video adds a Scene–Shot analysis manifest and keyframes. These support previews, inspection and later reads. A temporary presigned URL grants access; the stable bucket and object_path identify the object.')}</p>
      </div>
      <figure className="st-object-map">
        <figcaption>{text('一份视频留下的对象与索引', 'The objects and indexes behind one video')}</figcaption>
        <p className="reading-note">{text('以下用占位符展示当前路径与字段结构，不是实际知识库记录。', 'Placeholders below illustrate the current paths and fields; these are not live knowledge-base records.')}</p>
        <dl>
          <div><dt>{text('原始媒体', 'Original media')}</dt><dd><code>{'kb-{kb_id}/videos/{file_id}_{filename}.mp4'}</code><span>{text('原视频字节；不会被镜头描述替代。', 'Original video bytes, retained alongside the shot descriptions.')}</span></dd></div>
          <div><dt>{text('解析清单', 'Analysis manifest')}</dt><dd><code>{'videos/{file_id}/analysis/scene_shot_asr_v4.json'}</code><span>{text('记录 schema_version、file_id、duration 与 analysis 中的场景、镜头和转写。', 'Records schema_version, file_id and duration, plus the scenes, shots and transcripts in analysis.')}</span></dd></div>
          <div><dt>{text('关键帧对象', 'Keyframe object')}</dt><dd><code>{'videos/{file_id}/keyframes/{scene}_{shot}_{index}_{timestamp}.jpg'}</code><span>{text('时间戳写入文件名时保留三位小数，并把小数点替换为下划线。', 'The filename timestamp uses three decimal places, with the decimal point replaced by an underscore.')}</span></dd></div>
          <div><dt>{text('检索命中', 'Search match')}</dt><dd><code>video_shot_vectors → file_id + shot_id</code><span>{text('payload 同时携带 file_path、manifest_path、scene_id、shot_start_time 与 shot_end_time；因此能从一条匹配结果回到对应视频和镜头区间。', 'The payload also carries file_path, manifest_path, scene_id, shot_start_time and shot_end_time, connecting a match to its video and shot interval.')}</span></dd></div>
        </dl>
      </figure>
      <div className="reading-sources"><StorageSource path="backend/app/modules/ingestion/storage/minio_adapter.py">{text('对象命名与桶解析', 'Object names and bucket resolution')}</StorageSource><StorageSource path="backend/app/modules/ingestion/service.py">{text('派生物写入', 'Writing derived artifacts')}</StorageSource></div>
    </section>

    <section className="reading-section">
      <h2 className="reading-subhead">{text('向量按检索单元组织，不按文件扩展名堆在一起', 'Vectors follow retrieval units, not just file extensions')}</h2>
      <div className="reading-prose">
        <p>{text('Qdrant 使用按模态共享的 collection，靠 payload 的 kb_id、file_id 做范围过滤。一个 point 可以保存多个有名字的向量：图片的文字描述和视觉特征属于同一图片，却使用不同向量空间；视频则把镜头描述与 ASR 转写分成独立通道。不同通道的数值不能直接当成同一种相似度。', 'Qdrant uses shared collections organized by modality, with kb_id and file_id payload filters defining scope. A point can hold several named vectors: an image description and its visual features refer to the same image but inhabit different vector spaces. Video separates shot captions from ASR transcripts. Their scores are not interchangeable measures of similarity.')}</p>
      </div>
      <div className="reading-table-wrap st-schema-wrap" tabIndex={0} role="region" aria-labelledby={schemaCaption}>
        <table className="reading-table st-schema-table">
          <caption id={schemaCaption}>{text('当前源码定义的 collection、向量与代表性 payload', 'Collections, vectors and representative payload fields in the current source')}</caption>
          <thead><tr><th scope="col">{text('集合与检索单元', 'Collection and unit')}</th><th scope="col">{text('向量名与维度', 'Vector name and dimensions')}</th><th scope="col">{text('payload 字段选摘', 'Selected payload fields')}</th></tr></thead>
          <tbody>{collections.map(collection => <tr key={collection.name}><th scope="row"><code>{collection.name}</code><span>{collection.unit}</span></th><td data-label={text('向量名与维度', 'Vector name and dimensions')}>{collection.vectors.map(vector => <code className="st-field-line" key={vector}>{vector}</code>)}</td><td data-label={text('payload 字段选摘', 'Selected payload fields')}>{collection.fields.map(field => <code className="st-field-line" key={field}>{field}</code>)}</td></tr>)}</tbody>
        </table>
      </div>
      <p className="reading-note">{text('表中数值是当前 collection schema 的维度约束，稠密向量使用 Cosine；稀疏向量存词项索引与权重，不是另一条固定长度的 4096 维向量。图片视觉通道使用 CLIP，音频声学通道使用 CLAP。更换嵌入模型必须核对维度和已有索引兼容性；这张表不保证任意模型都能直接替换。', 'These dimensions are constraints in the current collection schema; dense vectors use Cosine distance. Sparse vectors store term indices and weights, rather than another fixed 4096-dimensional array. CLIP supplies image features and CLAP supplies audio features. Changing an embedding model requires checking dimensions and compatibility with existing indexes; arbitrary models are not drop-in replacements.')}</p>
      <div className="reading-prose">
        <p>{text('文档还区分 text_content 与 embedding_text：前者保留返回给读者的原文块，后者承载用于嵌入的表示。context_window 用相邻 point ID 连接前后块。独立音频目前以文件为单位写入 transcript、description 和 duration，并没有在这一入库路径中保存逐段转写时间；视频的 Shot 时间边界不能推广成所有音频都具备的能力。', 'Document payloads distinguish text_content from embedding_text: the former is the passage returned to the reader; the latter is the representation used for embedding. context_window links adjacent point IDs. Standalone audio currently stores transcript, description and duration at file level, without segment-level transcript timestamps in this ingestion path. Video shot timing therefore does not imply timestamped passages for every audio file.')}</p>
      </div>
      <div className="reading-sources"><StorageSource path="backend/app/modules/ingestion/storage/vector_store.py">{text('Collection 配置与 payload 写入', 'Collection configuration and payload writes')}</StorageSource></div>
    </section>

    <section className="reading-section">
      <h2 className="reading-subhead">{text('共同的来源身份，保留各自的定位精度', 'Shared source identity, with modality-specific locations')}</h2>
      <div className="reading-prose">
        <p>{text('最底层的连接是知识库与文件：kb_id 表明归属，file_id 指向原件，file_path 指向桶内对象。文档命中再带 chunk_index；解析器提供页信息时，metadata 保留页码，分块元数据也可保留原文字符范围。文档提取图额外用 source_file_id 指回母文档；视频用 scene_id、shot_id 和时间范围，关键帧再加 frame_timestamp 与 frame_image_path。', 'The base connection is the knowledge base and file: kb_id identifies membership, file_id identifies the original, and file_path locates its object. Document hits add chunk_index; metadata retains page information when supplied by the parser, and chunking metadata can preserve source character ranges. Extracted figures use source_file_id to identify their parent document. Video adds scene_id, shot_id and time bounds; keyframes add frame_timestamp and frame_image_path.')}</p>
        <p>{text('Pi 在这组字段之上建立来源目录，把 kb_id 与 file_id 的组合哈希成 source_id。它并不是要求每个 Qdrant payload 原生都有一个同名字段。实际 Evidence 再记录 source_id、version、observation、locator 和 provenance：文件身份回答“来自哪份资料”，locator 回答“读到了哪一部分”，observation 区分原文、描述、转写或计算结果。', 'Pi builds a source catalog above these fields and hashes the kb_id/file_id pair into a source_id. This does not mean every Qdrant payload natively contains that field. An Evidence record then carries source_id, version, observation, locator and provenance: source identity identifies the material, locator identifies the portion read, and observation distinguishes parsed text, captions, transcripts and calculations.')}</p>
      </div>
      <p className="reading-callout">{text('来源可定位，不等于内容已经被证实。页码和时间帮助回到材料；生成的图注、转写和摘要仍是各自的观察结果，不能把它们当成原件本身。', 'A locatable source is not a verified claim. Pages and time bounds help return to the material; captions, transcripts and summaries remain observations of it, rather than the original itself.')}</p>
      <div className="reading-sources"><StorageSource path="backend/app/modules/pi_agent/catalog.py">{text('来源目录与 source_id', 'Source catalog and source_id')}</StorageSource><StorageSource path="backend/app/modules/pi_agent/gateway.py">{text('Evidence 定位字段', 'Evidence locators')}</StorageSource><StorageSource path="backend/app/modules/ingestion/splitters/agentic.py">{text('原文范围与页信息', 'Source ranges and page metadata')}</StorageSource></div>
    </section>

    <section className="reading-section">
      <h2 className="reading-subhead">{text('目录、主题画像和上传状态，各自回答不同的问题', 'Catalog, topic portraits and upload status answer different questions')}</h2>
      <div className="reading-prose">
        <p>{text('知识库名称、描述和创建／更新时间写入桶内 .kb_meta.json，支持 UTF-8；知识库服务可以从这些对象恢复目录，旧桶标签作为兼容来源。主题画像则存在 Qdrant 的 kb_portraits：生成器采样已入库表示，做 K-Means 聚类，为主题生成摘要并嵌入。视频按 Scene 组织画像样本，避免把一段长视频的许多镜头重复放大。画像用于知识库路由，不替代文件证据。', 'Names, descriptions and creation/update times are stored in the bucket’s UTF-8 .kb_meta.json. The knowledge service can rebuild its catalog from these objects, with older bucket tags as a compatibility source. Topic portraits live in Qdrant’s kb_portraits instead: the generator samples indexed representations, applies K-Means, then summarizes and embeds the topics. Video portrait samples are grouped by scene so a long video’s many shots do not inflate its weight. Portraits help route to knowledge bases; they do not replace file evidence.')}</p>
        <p>{text('上传任务状态另存 Redis，带过期时间和知识库／文件查找键；Redis 不可用时回退进程内状态。文件列表把 MinIO 对象与这些任务状态合并，保留排队、处理中、失败及进度信息。视频还检查 Qdrant 中是否确实存在对应 Shot：只有原件、没有主索引时显示 unindexed，而不会仅因桶里有文件就声称可检索。', 'Upload-task status uses Redis with expiration and knowledge-base/file lookup keys, falling back to process memory if Redis is unavailable. The file list merges MinIO objects with these task records to show queued, processing and failed states plus progress. Video also checks for actual Shot records in Qdrant: an original without its main index is unindexed, rather than treated as searchable merely because a file exists in storage.')}</p>
      </div>
      <div className="reading-sources"><StorageSource path="backend/app/modules/knowledge/service.py">{text('目录恢复与文件状态', 'Catalog recovery and file status')}</StorageSource><StorageSource path="backend/app/modules/knowledge/portraits.py">{text('知识库画像', 'Knowledge-base portraits')}</StorageSource><StorageSource path="backend/app/modules/ingestion/service.py">{text('上传状态存储', 'Upload-status storage')}</StorageSource></div>
    </section>

    <section className="reading-section">
      <h2 className="reading-subhead">{text('存储职责的分界，也是恢复能力的分界', 'Storage responsibilities also define recovery boundaries')}</h2>
      <div className="reading-table-wrap st-roles-wrap" tabIndex={0} role="region" aria-labelledby={rolesCaption}>
        <table className="reading-table st-roles-table">
          <caption id={rolesCaption}>{text('每一类存储保存什么', 'What each store retains')}</caption>
          <thead><tr><th scope="col">{text('存储', 'Store')}</th><th scope="col">{text('负责保存', 'Retains')}</th><th scope="col">{text('不由它证明', 'Does not establish')}</th></tr></thead>
          <tbody>
            <tr><th scope="row">MinIO</th><td data-label={text('负责保存', 'Retains')}>{text('原件、派生物、知识库元数据', 'Originals, derivatives and knowledge-base metadata')}</td><td data-label={text('不由它证明', 'Does not establish')}>{text('索引已完成或模型理解正确', 'Index completion or correct model interpretation')}</td></tr>
            <tr><th scope="row">Qdrant</th><td data-label={text('负责保存', 'Retains')}>{text('检索向量、文本与来源 payload、主题画像', 'Search vectors, text/source payloads and topic portraits')}</td><td data-label={text('不由它证明', 'Does not establish')}>{text('原件字节完整可用，或答案得到支持', 'Original-file availability or support for an answer')}</td></tr>
            <tr><th scope="row">Redis</th><td data-label={text('负责保存', 'Retains')}>{text('有期限的上传任务状态与查找键', 'Expiring upload-task status and lookup keys')}</td><td data-label={text('不由它证明', 'Does not establish')}>{text('永久任务历史或持久知识库目录', 'Permanent task history or a durable knowledge catalog')}</td></tr>
            <tr><th scope="row">SQLite · Pi</th><td data-label={text('负责保存', 'Retains')}>{text('运行、顺序事件、证据与产物记录', 'Runs, ordered events, evidence and artifact records')}</td><td data-label={text('不由它证明', 'Does not establish')}>{text('整个应用的会话持久化', 'Persistence for every application conversation')}</td></tr>
          </tbody>
        </table>
      </div>
      <div className="reading-prose">
        <p>{text('Pi 的 runs.sqlite3 启用 WAL，分别记录 pi_runs、pi_events、pi_evidence 和 pi_artifacts，事务把状态变更与事件写在一起。它独立于知识库索引，也独立于常规聊天 API 的进程内 sessions 字典；因此不能从“Pi 有 SQLite 账本”推导出“所有后端会话都已持久化”。', 'Pi’s runs.sqlite3 uses WAL and separate pi_runs, pi_events, pi_evidence and pi_artifacts tables; transactions couple state changes with event writes. It is separate from the knowledge indexes and from the regular chat API’s in-memory sessions dictionary. A SQLite ledger for Pi therefore does not mean every backend conversation is durable.')}</p>
      </div>
      <div className="st-tradeoff">
        <h3>{text('为什么不把原件和索引合成一个存储？', 'Why keep originals and indexes separate?')}</h3>
        <p>{text('文件需要按原样下载、预览与核对；检索表示需要按模态查询、过滤和替换。分开后，重新生成某种表示有机会复用已保存原件，原件也不必随着每次检索被完整读取。代价是跨存储的一致性必须由应用维护：上传成功、解析成功、向量写入成功并不是一次共同提交。视频重试会清理同文件的旧索引再写入，文件列表也要分别核对对象和索引状态。', 'Files need faithful download, preview and inspection; search representations need modality-specific queries, filters and replacement. Separation lets a representation be rebuilt from a retained original and avoids reading the whole file for each search. The cost is application-managed consistency across stores: upload, parsing and vector writes are not a single commit. Video retries clear the file’s previous index before writing replacements, and file listing checks objects and index state separately.')}</p>
      </div>
      <div className="reading-sources"><StorageSource path="backend/app/modules/pi_agent/store.py">{text('Pi SQLite 账本', 'Pi SQLite ledger')}</StorageSource><StorageSource path="backend/app/api/chat.py">{text('常规后端会话', 'Regular backend sessions')}</StorageSource><StorageSource path="README.md">{text('项目能力与边界', 'Project capabilities and boundaries')}</StorageSource></div>
    </section>
  </div>
}
