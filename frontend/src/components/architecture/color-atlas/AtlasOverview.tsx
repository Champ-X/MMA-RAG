import { ArrowRight, ArrowUpRight, FileText, Image, Music2, Play, Video } from 'lucide-react'
import { AtlasPaper, AtlasWaveform, type AtlasText } from './AtlasPrimitives'
import type { AtlasMaterial } from './AtlasParsing'

export function AtlasOverview({ text, onExplore }: { text: AtlasText; onExplore: (chapter: number, material?: AtlasMaterial) => void }) {
  const exploreMark = <ArrowUpRight className="ca-explore-mark" aria-hidden="true" />
  return <>
    <section className="ca-cover">
      <div className="ca-cover-copy">
        <h1 id="book-heading" tabIndex={-1}>Tessmora <br />{text('系统架构', 'architecture')}</h1>
        <p>{text('从上传一份文件开始，看系统怎样建立索引、检索相关材料，以及怎样通过回答中的引用打开原件。', 'Follow an uploaded file through indexing and search, then use a citation in the answer to open the source.')}</p>
        <button type="button" className="ca-primary book-start" onClick={() => onExplore(1)}>{text('探索架构', 'Explore the architecture')}<ArrowRight size={20} aria-hidden="true" /></button>
      </div>
      <div className="ca-collage" role="group" aria-label={text('资料、搜索表示与引用的连接', 'Source material, searchable representations and citations')}>
        <div className="ca-collage-folder"><span>{text('资料', 'Materials')}</span></div>
        <button type="button" className="ca-collage-photo" onClick={() => onExplore(2, 'image')} aria-label={text('查看图片如何解析', 'Explore image parsing')}>
          <img src="/architecture/atlas/concrete-architecture.webp" width="1000" height="1000" {...{ fetchpriority: 'high' }} loading="eager" alt={text('素材空间中的混凝土图书馆，天窗光线落在阶梯与地面上', 'Concrete library from the material space, with daylight falling on its stairs and floor')} />
          <span>{text('原件', 'Original')}</span>{exploreMark}
        </button>
        <AtlasPaper className="ca-collage-document">
          <h2>{text('建筑与空间', 'Space & light')}</h2>
          <p>{text('天窗引入自然光，', 'Daylight enters from above,')}<br />{text('粗粝的混凝土表面，', 'tracing the concrete surfaces')}<br />{text('留下明暗交错的层次。', 'with layers of light and shade.')}</p>
          <img src="/architecture/atlas/architectural-plan.webp" alt="" width="1000" height="1000" loading="eager" />
          <span className="ca-highlight-mark" />
        </AtlasPaper>
        <div className="ca-collage-small-photo"><img src="/architecture/atlas/garden.webp" width="800" height="600" loading="eager" alt={text('园林资料中的曲廊与花木', 'Garden architecture and foliage from the material space')} /></div>
        <button className="ca-collage-audio" type="button" onClick={() => onExplore(2, 'audio')} aria-label={text('了解音频搜索表示', 'Explore audio representations')}><span>{text('搜索表示', 'Search representation')}</span><AtlasWaveform />{exploreMark}</button>
        <button className="ca-collage-film" type="button" onClick={() => onExplore(2, 'video')} aria-label={text('查看视频解析', 'Explore video parsing')}>
          <div>{[1, 2, 3].map(index => <img key={index} src={`/architecture/atlas/forest-frame-${index}.webp`} width="640" height="360" alt="" loading="eager" />)}</div>
          <span><Play size={15} fill="currentColor" aria-hidden="true" />{text('森林影像', 'Forest footage')} <small>00:01 — 00:08</small></span>{exploreMark}
        </button>
        <button className="ca-collage-citation ca-paper" type="button" onClick={() => onExplore(6)}>
          <span>{text('引用', 'Citation')}</span><p>{text('光线从天窗倾泻而下，', 'Light falls through the skylights,')}<br />{text('照亮了混凝土地面。', 'illuminating the concrete floor.')}</p><i>[1]</i>{exploreMark}
        </button>
        <svg className="ca-collage-connector" viewBox="0 0 700 520" fill="none" aria-hidden="true"><path d="M501 210 C632 205 642 243 642 311 L642 407" stroke="#ef8d51" strokeWidth="3" /><circle cx="501" cy="210" r="6" fill="#ef8d51" stroke="#fffdf5" /><circle cx="642" cy="407" r="5" fill="#ef8d51" stroke="#fffdf5" /></svg>
      </div>
    </section>
    <nav className="ca-journey" aria-label={text('从资料到回答', 'From material to answer')}>
      <button className="ca-journey-origin" onClick={() => onExplore(2)} type="button">
        {exploreMark}<span className="ca-journey-number">1</span>
        <div className="ca-mini-sources" aria-hidden="true"><AtlasPaper><b>{text('中国古典园林', 'Chinese gardens')}</b><span>{text('借一片远山，框一窗景致。', 'Borrow a view. Frame a scene.')}</span><i /><i /><i /></AtlasPaper><img src="/architecture/atlas/concrete-architecture.webp" width="1000" height="1000" alt="" loading="lazy" /><AtlasWaveform /></div>
        <h2>{text('文件解析', 'File parsing')}</h2><p>{text('文档按结构分块，独立音频以文件为单位，视频按镜头索引。选择一种文件，查看索引保存的字段。', 'Documents are split into passages, standalone audio is indexed by file, and video by shot. Choose a file type to see which fields the index stores.')}</p>
      </button>
      <button className="ca-journey-search" onClick={() => onExplore(4)} type="button">
        {exploreMark}<div className="ca-journey-heading"><span className="ca-journey-number">2</span><h2>{text('检索与排序', 'Retrieval and ranking')}</h2></div>
        <div className="ca-mini-search" aria-hidden="true"><ul>{[[FileText, text('文档片段', 'Passages')], [Image, text('图像内容', 'Images')], [Music2, text('音频文件', 'Audio files')], [Video, text('视频片段', 'Video shots')]].map(([Icon, label], index) => { const Glyph = Icon as typeof FileText; return <li key={index}><Glyph size={15} /><span>{label as string}</span></li> })}</ul><svg viewBox="0 0 155 108"><path d="M0 12 C90 12 45 42 130 42" /><path d="M0 40 C70 40 65 50 130 50" /><path d="M0 68 C75 68 70 58 130 58" /><path d="M0 96 C80 96 55 66 130 66" /><g fill="currentColor" stroke="none">{Array.from({length: 16},(_, i)=><circle key={i} cx={132+i%4*6} cy={42+Math.floor(i/4)*8} r="1.5" />)}</g></svg><div className="ca-mini-results">{[1,2,3,4].map(n=><i key={n}><b /></i>)}<span>{text('相关线索', 'Relevant clues')}</span></div></div>
        <p>{text('用建筑采光和园林借景这两个查询，查看检索返回的图片和段落。', 'See the images and passages returned for two queries about architectural lighting and borrowed scenery in gardens.')}</p>
      </button>
      <button className="ca-journey-source" onClick={() => onExplore(6)} type="button">
        {exploreMark}<div className="ca-journey-heading"><span className="ca-journey-number">3</span><h2>{text('回到来源', 'Return to the source')}</h2></div>
        <div className="ca-mini-citation" aria-hidden="true"><AtlasPaper><b>{text('原文片段', 'Source passage')}</b><i /><i /><mark /><i /><i /></AtlasPaper><img src="/architecture/atlas/concrete-architecture.webp" width="1000" height="1000" alt="" loading="lazy" /><span /></div>
        <p>{text('沿着引用回到原始资料，查看具体位置，核对上下文。', 'Follow a citation to the original, inspect its location and check the context.')}</p>
      </button>
    </nav>
    <p className="ca-cover-note">{text('画面中的建筑、园林、音乐与影像取自素材空间。检索章节展示真实查询快照，可继续查看原件。', 'Architecture, gardens, music and footage come from the material spaces. The retrieval chapter includes saved results from actual queries.')}</p>
  </>
}
