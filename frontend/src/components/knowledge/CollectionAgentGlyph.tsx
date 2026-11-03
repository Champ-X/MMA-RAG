import './collectionAgentGlyph.css'

/** A source card and compass for finding material beyond the current space. */
export function CollectionAgentGlyph({ size = 40 }: { size?: number }) {
  return <svg className="collection-agent-glyph" width={size} height={size}
    viewBox="0 0 40 40" fill="none" strokeWidth="1.55" strokeLinecap="round" strokeLinejoin="round"
    aria-hidden="true" focusable="false">
    <rect className="collection-agent-glyph__back" x="4.5" y="6" width="21" height="26" rx="3.5"
      transform="rotate(-9 15 19)" />
    <rect className="collection-agent-glyph__paper" x="7.5" y="4" width="21" height="26" rx="3.5" />
    <path className="collection-agent-glyph__line" d="M12 10h11m-11 4.5h6" />
    <circle className="collection-agent-glyph__face" cx="25" cy="25" r="12" />
    <path className="collection-agent-glyph__ticks" d="M25 16v1.5m9 7.5h-1.5M25 34v-1.5M16 25h1.5" />
    <path className="collection-agent-glyph__north" d="m30.5 19.5-2.8 8.2-5.4-5.4z" />
    <path className="collection-agent-glyph__south" d="m19.5 30.5 2.8-8.2 5.4 5.4z" />
    <circle className="collection-agent-glyph__pivot" cx="25" cy="25" r="1.3" />
  </svg>
}
