import './uploadSourceGlyph.css'

export type UploadSourceGlyphName = 'upload' | 'document' | 'folder' | 'link' | 'image' | 'news'

/** Compact stationery-inspired symbols for adding material to a knowledge space. */
export function UploadSourceGlyph({ name, size = 28, className = '' }: {
  name: UploadSourceGlyphName
  size?: number
  className?: string
}) {
  return (
    <svg
      className={`upload-source-glyph ${className}`}
      data-source-glyph={name}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {name === 'upload' && (
        <>
          <path className="upload-source-glyph-surface" d="M3.5 13.5h4.8l1.7 2h4l1.7-2h4.8v6a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2Z" />
          <path d="M12 12V2.5m-4 4 4-4 4 4" />
          <path className="upload-source-glyph-detail" d="M10 18.5h4" />
        </>
      )}
      {name === 'document' && (
        <>
          <path className="upload-source-glyph-surface" d="M12.5 2.5h-7a2 2 0 0 0-2 2v15a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-12Z" />
          <path className="upload-source-glyph-paper" d="M12.5 2.5v5h5Z" />
          <path className="upload-source-glyph-detail" d="M6.5 11h5m-5 3.5h3" />
          <path className="upload-source-glyph-accent" d="m11.5 16.5 7-7 3 3-7 7-4 1Z" />
          <path className="upload-source-glyph-accent-line" d="m17 11 3 3m-8.5 2.5 3 3" />
        </>
      )}
      {name === 'folder' && (
        <>
          <path className="upload-source-glyph-surface" d="M2.5 17V7a2 2 0 0 1 2-2h4l2 2h9a2 2 0 0 1 2 2v8" />
          <rect className="upload-source-glyph-paper" x="7.5" y="2.5" width="10" height="14" rx="2" />
          <path className="upload-source-glyph-detail" d="M10.5 6h4m-4 3h4" />
          <path className="upload-source-glyph-surface" d="M4 11h16a1.5 1.5 0 0 1 1.5 1.7l-.8 6a2 2 0 0 1-2 1.8H5.3a2 2 0 0 1-2-1.8l-.8-6A1.5 1.5 0 0 1 4 11Z" />
          <path className="upload-source-glyph-detail" d="M9 15.5h6" />
        </>
      )}
      {name === 'link' && (
        <>
          <rect className="upload-source-glyph-frame" x="2" y="3" width="20" height="18" rx="3" />
          <path className="upload-source-glyph-frame-line" d="M2 7h20" />
          <path className="upload-source-glyph-detail" d="M5.5 5h.5" />
          <path d="m11 16.5-1 1a3.2 3.2 0 0 1-4.5-4.5l2-2a3.2 3.2 0 0 1 4.5 0" />
          <path className="upload-source-glyph-accent-line" d="m13 11.5 1-1a3.2 3.2 0 0 1 4.5 4.5l-2 2a3.2 3.2 0 0 1-4.5 0" />
          <path d="m9.5 15.5 5-3" />
        </>
      )}
      {name === 'image' && (
        <>
          <rect className="upload-source-glyph-paper" x="2.5" y="3" width="17" height="17" rx="3" />
          <path className="upload-source-glyph-surface" d="m3 16 4.5-5 4 4 2.5-2.5 5 5V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
          <circle className="upload-source-glyph-accent" cx="13.5" cy="7.5" r="2" />
          <path className="upload-source-glyph-lens-line" d="m19 18.5 3 3" strokeWidth="2.2" />
          <circle className="upload-source-glyph-lens" cx="16.5" cy="16" r="4" />
        </>
      )}
      {name === 'news' && (
        <>
          <path className="upload-source-glyph-surface" d="M17.5 8.5h4v11a2 2 0 0 1-2 2h-4Z" />
          <path className="upload-source-glyph-surface" d="M3 3h14.5v16.5a2 2 0 0 0 2 2H5a2 2 0 0 1-2-2Z" />
          <path className="upload-source-glyph-detail" d="M6 6.5h8m-8 11h8" />
          <rect className="upload-source-glyph-accent" x="6" y="10" width="4" height="4" rx=".8" />
          <path className="upload-source-glyph-detail" d="M13 10.5h1m-1 3h1" />
        </>
      )}
    </svg>
  )
}
