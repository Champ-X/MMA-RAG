import { FileText, Film, ArrowUpRight, ScanText } from 'lucide-react'

type Text = (zh: string, en: string) => string

export function EditorialArtwork({ kind, text }: { kind: 'representation' | 'evidence'; text: Text }) {
  const representation = kind === 'representation'
  return <figure className={`editorial-art editorial-art--${kind}`}>
    <img src={`/architecture/illustrations/${representation ? 'representation-layers' : 'evidence-lens'}.webp`} width="1254" height="1254" loading="lazy" decoding="async" alt={representation
      ? text('原始资料与分离出来的半透明表示层并存，位置标记维持它们之间的联系。', 'Original material and translucent representation layers coexist, connected by location markers.')
      : text('透镜聚焦原始材料，选中的证据与答案相连。', 'A lens focuses on original material, connecting selected evidence to an answer.')} />
    <figcaption><span>{representation ? text('保留原件', 'Keep the original') : text('定位来源', 'Locate the source')}</span><span>{representation ? text('理解内容', 'Represent its meaning') : text('回看语境', 'Return to context')}</span><span>{representation ? text('建立联系', 'Keep them connected') : text('核对结论', 'Inspect the claim')}</span></figcaption>
  </figure>
}

export function CitationFigure({ text }: { text: Text }) {
  return <figure className="citation-map">
    <div className="citation-map-sources">
      <div><FileText size={19} aria-hidden="true" /><span>{text('原文片段', 'Text passage')}</span><b>[1]</b></div>
      <div><Film size={19} aria-hidden="true" /><span>{text('视频转写', 'Video transcript')}</span><b>[2]</b></div>
      <div className="citation-map-unused"><ScanText size={19} aria-hidden="true" /><span>{text('其余候选', 'Other candidates')}</span><b>[3]</b></div>
    </div>
    <div className="citation-map-link" aria-hidden="true"><span /><ArrowUpRight size={20} /><span /></div>
    <div className="citation-map-answer"><strong>{text('回答正文', 'Answer prose')}</strong><p>{text('结论与说明', 'A claim and its explanation')} <b>[2]</b></p><p>{text('另一条有依据的陈述', 'Another sourced statement')} <b>[1]</b></p><div>{text('来源顺序', 'Source order')}<span>[2]</span><span>[1]</span></div></div>
    <figcaption>{text('编号随来源保留，列表随正文引用出现的顺序排列。未使用的候选不进入最终列表。示意内容不代表实际检索。', 'IDs stay with their sources; the final list follows citation order in the prose. Unused candidates stay out. This is an illustration, not a live retrieval.')}</figcaption>
  </figure>
}
