type SidebarGlyphName = 'new-conversation' | 'knowledge' | 'architecture' | 'settings'

/** A shared optical grid and quiet duotone detail for the sidebar navigation. */
export function SidebarGlyph({ name, size = 22 }: { name: SidebarGlyphName; size?: number }) {
  return (
    <svg
      className="sidebar-glyph"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {name === 'new-conversation' && (
        <>
          <path className="sidebar-glyph-wash" d="M6.5 4.5h11a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3H9l-5.5 3v-14a3 3 0 0 1 3-3Z" />
          <path d="M6.5 4.5h11a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3H9l-5.5 3v-14a3 3 0 0 1 3-3Z" />
          <path className="sidebar-glyph-accent" d="M9 11.5h6m-3-3v6" />
        </>
      )}
      {name === 'knowledge' && (
        <>
          <rect className="sidebar-glyph-wash" x="3.5" y="6.5" width="15" height="14" rx="2.75" />
          <path className="sidebar-glyph-accent" d="M7 3.5h10.5a3 3 0 0 1 3 3V17" />
          <rect x="3.5" y="6.5" width="15" height="14" rx="2.75" />
          <path d="M8 6.5v14" />
          <path className="sidebar-glyph-accent" d="M11.5 11h3.5m-3.5 4h2.5" />
        </>
      )}
      {name === 'architecture' && (
        <>
          <path className="sidebar-glyph-accent" d="M8.5 12h2a2 2 0 0 0 2-2V7a2 2 0 0 1 2-2h1m-3 5v7a2 2 0 0 0 2 2h1" />
          <rect className="sidebar-glyph-wash" x="2.5" y="9" width="6" height="6" rx="1.75" />
          <rect x="2.5" y="9" width="6" height="6" rx="1.75" />
          <rect x="15.5" y="2.5" width="6" height="5" rx="1.5" />
          <rect x="15.5" y="16.5" width="6" height="5" rx="1.5" />
        </>
      )}
      {name === 'settings' && (
        <>
          <path d="M3.5 6h3m5 0h9m-17 6h9m5 0h3m-17 6h3m5 0h9" />
          <g className="sidebar-glyph-accent">
            <rect x="6.5" y="3.5" width="5" height="5" rx="1.75" />
            <rect x="12.5" y="9.5" width="5" height="5" rx="1.75" />
            <rect x="6.5" y="15.5" width="5" height="5" rx="1.75" />
          </g>
          <rect className="sidebar-glyph-wash" x="6.5" y="3.5" width="5" height="5" rx="1.75" />
          <rect className="sidebar-glyph-wash" x="12.5" y="9.5" width="5" height="5" rx="1.75" />
          <rect className="sidebar-glyph-wash" x="6.5" y="15.5" width="5" height="5" rx="1.75" />
        </>
      )}
    </svg>
  )
}
