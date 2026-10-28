import './sidebarGlyph.css'

type SidebarGlyphName = 'new-conversation' | 'knowledge' | 'architecture' | 'settings'
  | 'select' | 'pin' | 'pin-off' | 'rename' | 'delete' | 'search' | 'language' | 'sun' | 'moon'

/** Small, layered symbols sharing one optical grid and theme-aware palette. */
export function SidebarGlyph({ name, size = 24, className = '' }: {
  name: SidebarGlyphName
  size?: number
  className?: string
}) {
  return (
    <svg
      className={`sidebar-glyph ${className}`}
      data-glyph={name}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {name === 'new-conversation' && (
        <>
          <path className="sidebar-glyph-surface" d="M14 4.5H7a4 4 0 0 0-4 4v12l4.5-3H16a4 4 0 0 0 4-4v-2" />
          <path className="sidebar-glyph-detail" d="M7.5 10h4m-4 3.5h7" />
          <circle className="sidebar-glyph-solid" cx="18" cy="6" r="4.25" />
          <path className="sidebar-glyph-knockout" d="M16 6h4m-2-2v4" />
        </>
      )}
      {name === 'knowledge' && (
        <>
          <path className="sidebar-glyph-surface" d="M3 17.5V6.5a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9" />
          <rect className="sidebar-glyph-paper" x="6" y="3" width="11" height="13" rx="2" transform="rotate(8 11.5 9.5)" />
          <path className="sidebar-glyph-accent" d="m13 4.5-.5 4 1.7-.7 1.4 1.1.5-4" />
          <path className="sidebar-glyph-surface" d="M4.5 10h15a2 2 0 0 1 2 2.3l-.9 6a2 2 0 0 1-2 1.7H5.4a2 2 0 0 1-2-1.7l-.9-6a2 2 0 0 1 2-2.3Z" />
          <path className="sidebar-glyph-detail" d="M8.5 14.5h7" />
        </>
      )}
      {name === 'architecture' && (
        <>
          <path d="M8 12h2.5a2 2 0 0 0 2-2V7a2 2 0 0 1 2-2H16m-3.5 5v7a2 2 0 0 0 2 2H16" />
          <rect className="sidebar-glyph-surface" x="2" y="8.5" width="7" height="7" rx="2" />
          <rect className="sidebar-glyph-accent" x="15.5" y="2" width="6.5" height="6" rx="1.8" />
          <rect className="sidebar-glyph-secondary" x="15.5" y="16" width="6.5" height="6" rx="1.8" />
        </>
      )}
      {name === 'settings' && (
        <>
          <path d="M3 6h18M3 12h18M3 18h18" />
          <rect className="sidebar-glyph-accent" x="6" y="3.5" width="5" height="5" rx="1.8" />
          <rect className="sidebar-glyph-surface" x="13" y="9.5" width="5" height="5" rx="1.8" />
          <rect className="sidebar-glyph-secondary" x="6" y="15.5" width="5" height="5" rx="1.8" />
        </>
      )}
      {name === 'select' && (
        <>
          <rect className="sidebar-glyph-surface" x="3.5" y="3" width="17" height="18" rx="3" />
          <path className="sidebar-glyph-detail" d="m7 8 1.5 1.5L11 7m-4 8 1.5 1.5L11 14" />
          <path d="M14 8.5h3m-3 7h3" />
        </>
      )}
      {(name === 'pin' || name === 'pin-off') && (
        <>
          <path d="M12 15v7" />
          <path className="sidebar-glyph-surface" d="M8 3h8l-1 7 3 3v2H6v-2l3-3-1-7Z" />
          <path className="sidebar-glyph-detail" d="M7 3h10" />
          {name === 'pin-off' && <>
            <path className="sidebar-glyph-cutout" d="m3 3 18 18" strokeWidth="4.5" />
            <path d="m3 3 18 18" />
          </>}
        </>
      )}
      {name === 'rename' && (
        <>
          <path className="sidebar-glyph-surface" d="m14.5 4.5 5 5L9 20l-6 1 1-6Z" />
          <path className="sidebar-glyph-accent" d="m14.5 4.5 1.2-1.2a2.1 2.1 0 0 1 3 0l2 2a2.1 2.1 0 0 1 0 3l-1.2 1.2Z" />
          <path className="sidebar-glyph-paper" d="m4 15 5 5-6 1Z" />
        </>
      )}
      {name === 'delete' && (
        <>
          <path className="sidebar-glyph-surface" d="M5.5 6.5h13l-1 12a2 2 0 0 1-2 2h-7a2 2 0 0 1-2-2Z" />
          <path d="M4 6.5h16M9 6.5V4a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 4v2.5" />
          <path className="sidebar-glyph-detail" d="m9.5 10.5.5 6m4.5-6-.5 6" />
        </>
      )}
      {name === 'search' && (
        <>
          <path className="sidebar-glyph-accent" d="m15.5 15.5 5 5" strokeWidth="3" />
          <circle className="sidebar-glyph-surface" cx="10" cy="10" r="7" />
          <path className="sidebar-glyph-detail" d="M6.5 9.5a3.5 3.5 0 0 1 3-3" />
        </>
      )}
      {name === 'language' && (
        <>
          <rect className="sidebar-glyph-surface" x="2" y="2.5" width="12" height="14" rx="3" />
          <path d="M5 7h6M8 5.5V7m2 0c-.5 3-2 4.5-5 6m1-4c1 2 2.5 3 5 4" strokeWidth="1.4" />
          <rect className="sidebar-glyph-accent" x="10" y="9" width="12" height="13" rx="3" />
          <path className="sidebar-glyph-accent-line" d="m13 18.5 3-6 3 6m-4.8-2h3.6" strokeWidth="1.5" />
        </>
      )}
      {name === 'moon' && (
        <>
          <path className="sidebar-glyph-surface" d="M19.5 14A8.5 8.5 0 0 1 10 3a8.7 8.7 0 1 0 9.5 11Z" />
          <path className="sidebar-glyph-accent" d="m18 2 .9 2.6 2.6.9-2.6.9L18 9l-.9-2.6-2.6-.9 2.6-.9L18 2Z" strokeWidth="1.2" />
        </>
      )}
      {name === 'sun' && (
        <>
          <path className="sidebar-glyph-detail" d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5" />
          <circle className="sidebar-glyph-surface" cx="12" cy="12" r="5" />
        </>
      )}
    </svg>
  )
}
