import { ArrowUpRight, BookOpen, ChevronDown, FileText, Image as ImageIcon } from 'lucide-react'
import { AtlasImage } from './AtlasImage'
import type { AtlasText } from './AtlasPrimitives'
import { useAtlasSelection } from './useAtlasSelection'

const assets = '/architecture/atlas/'

/** These are the two captured whole-query examples in retrieval-examples.json. */
export function AtlasCasebook({ text }: { text: AtlasText }) {
  const [open, setOpen] = useAtlasSelection<boolean>('casebook-open', false, [false, true])
  return <details className="ca-casebook" open={open} onToggle={event => setOpen(event.currentTarget.open)}>
    <summary><span className="ca-casebook-thumbnails" aria-hidden="true"><img src={`${assets}concrete-architecture.webp`} alt="" /><img src={`${assets}garden.webp`} alt="" /></span><span><strong><BookOpen size={17} aria-hidden="true" />{text('打开真实素材样本册', 'Open the source casebook')}</strong><small>{text('一座建筑，一方园林。从问题走回原件。', 'An architectural space. A garden. Follow each question to its source.')}</small></span><ChevronDown size={19} aria-hidden="true" /></summary>
    <div className="ca-casebook-body">
      <div className="ca-casebook-intro"><span>{text('真实资料 · 保存的检索记录', 'Actual material · saved retrieval records')}</span><span>2026.10.25</span></div>
      <div className="ca-casebook-grid">
        <article className="ca-casebook-case ca-casebook-case--image">
          <AtlasImage src={`${assets}concrete-architecture.webp`} alt={text('粗野主义混凝土建筑中的自然光', 'Natural light in a brutalist concrete building')} title={text('混凝土与自然光', 'Concrete and natural light')} caption={text('来自「视觉风格素材库」的粗野主义混凝土.png；此处为保留构图的 WebP 预览。', 'Brutalist concrete.png from the visual-style collection, presented as a WebP preview with its composition retained.')} text={text} />
          <div className="ca-casebook-case-copy"><span className="ca-casebook-type"><ImageIcon size={15} aria-hidden="true" />{text('图像 / 建筑光影', 'Image / architectural light')}</span><h3>{text('光，从结构之间落下。', 'Light falls between structures.')}</h3><p className="ca-casebook-question">{text('“建筑空间中，混凝土与自然光如何形成光影层次？”', '“How do concrete and natural light create layers of light and shade?”')}</p><p>{text('检索返回原图与图片描述。放大画面，可以继续核对天窗、材质与光影关系。', 'Retrieval returned the image with its caption. Enlarge it to inspect the skylights, materials and light for yourself.')}</p><small>{text('视觉风格素材库 · 粗野主义混凝土.png', 'Visual-style collection · Brutalist concrete.png')}</small></div>
        </article>
        <article className="ca-casebook-case ca-casebook-case--document">
          <div className="ca-casebook-garden"><AtlasImage src={`${assets}garden.webp`} alt={text('园林水面、建筑与植物', 'Water, architecture and plants in a garden')} title={text('园林空间', 'Garden space')} caption={text('来自「风景人文」的园林.jpg，为同素材空间配图，并非检索文档的内嵌图片。', 'Garden.jpg from the landscape collection: a companion illustration, not an embedded image from the retrieved document.')} text={text} /><span>{text('同素材空间配图', 'Companion collection image')}</span></div>
          <div className="ca-casebook-case-copy"><span className="ca-casebook-type"><FileText size={15} aria-hidden="true" />{text('原文 / 园林意境', 'Text / garden atmosphere')}</span><h3>{text('一扇窗，框住一方天地。', 'A window frames a world.')}</h3><blockquote>{text('框景则是以门洞、窗棂、廊柱为“画框”，将框内的景物裁剪成一幅天然的图画。', 'Framed views use doorways, window lattices and corridor columns as a frame, composing the scenery into a natural picture.')}</blockquote><small>{text('中国古典园林的意境与哲学.md · chunk 18 / 17', 'Chinese garden atmosphere and philosophy.md · chunks 18 / 17')}</small><a href={`${assets}garden-notes.md`} target="_blank" rel="noreferrer">{text('阅读全文，核对上下文', 'Read the source in context')}<ArrowUpRight size={14} aria-hidden="true" /></a></div>
        </article>
      </div>
      <footer><p>{text('案例来自已保存的完整检索，展开或切换不会发起实时查询。英文节选为界面翻译。', 'These are saved whole-query results. Expanding or switching examples sends no live query. English excerpts are interface translations.')}</p><div><a href={`${assets}retrieval-examples.json`} target="_blank" rel="noreferrer">{text('检索记录', 'Retrieval records')}<ArrowUpRight size={13} aria-hidden="true" /></a><a href={`${assets}provenance.json`} target="_blank" rel="noreferrer">{text('素材来源', 'Asset provenance')}<ArrowUpRight size={13} aria-hidden="true" /></a></div></footer>
    </div>
  </details>
}
