import './topicAtlasGlyph.css'

/** Decorative wayfinding symbols; the topic map itself owns the data marks. */
export function TopicAtlasGlyph({ name, size = 20 }: {
  name: 'constellation' | 'directory'
  size?: number
}) {
  return <svg className="topic-atlas-glyph" data-symbol={name} width={size} height={size}
    viewBox="0 0 28 28" fill="none" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"
    aria-hidden="true" focusable="false">
    {name === 'constellation' ? <>
      <path className="topic-atlas-glyph__connection" d="m7 7 7 6 7-8m-7 8 5 8-13 1 1-15" />
      <circle className="topic-atlas-glyph__mint" cx="7" cy="7" r="3.5" />
      <circle className="topic-atlas-glyph__amber" cx="21" cy="5" r="2.8" />
      <circle className="topic-atlas-glyph__violet" cx="19" cy="21" r="3.2" />
      <circle className="topic-atlas-glyph__mint" cx="6" cy="22" r="2.3" />
      <circle className="topic-atlas-glyph__junction" cx="14" cy="13" r="1.7" />
    </> : <>
      <rect className="topic-atlas-glyph__violet" x="7" y="2.5" width="17.5" height="20" rx="3" />
      <rect className="topic-atlas-glyph__sheet" x="3.5" y="5.5" width="18" height="20" rx="3" />
      <path className="topic-atlas-glyph__line" d="M12 10.5h6m-6 5h6m-6 5h4" />
      <rect className="topic-atlas-glyph__mint" x="6.5" y="9" width="3" height="3" rx=".9" />
      <rect className="topic-atlas-glyph__violet" x="6.5" y="14" width="3" height="3" rx=".9" />
      <rect className="topic-atlas-glyph__amber" x="6.5" y="19" width="3" height="3" rx=".9" />
    </>}
  </svg>
}
