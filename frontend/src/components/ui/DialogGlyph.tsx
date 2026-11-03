import type { ReactNode } from 'react'
import './dialogGlyph.css'

export type DialogGlyphName = 'knowledge' | 'model' | 'route' | 'library' | 'sliders' | 'space' | 'document' | 'folder' | 'search' | 'image' | 'audio' | 'video' | 'conversation'

const fill = 'var(--dg-fill)'
const secondary = 'var(--dg-secondary)'

/** A shared optical grid for workflow symbols. Color supports each recognizable silhouette. */
export function DialogGlyph({ name, size = 24, className = '' }: { name: DialogGlyphName; size?: number; className?: string }) {
  const artwork: Record<DialogGlyphName, ReactNode> = {
    knowledge: <><path d="M4 6v11c0 2 3.6 3.5 8 3.5s8-1.5 8-3.5V6" fill={fill} /><ellipse cx="12" cy="6" rx="8" ry="3.5" /><path d="M4 11.5c0 2 3.6 3.5 8 3.5s8-1.5 8-3.5" /><path d="m15.5 17 1.2 1.2 2.8-2.8" stroke={secondary} /></>,
    model: <><rect x="5" y="5" width="14" height="14" rx="3.5" fill={fill} /><path d="M9 2.5V5m6-2.5V5M9 19v2.5m6-2.5V19M2.5 9H5m-2.5 6H5m14-6h2.5M19 15h2.5" /><rect x="9" y="9" width="6" height="6" rx="1.5" fill={secondary} stroke={secondary} /></>,
    route: <><path d="M6 5h11a4 4 0 0 1 0 8H7a3 3 0 0 0 0 6h11" /><circle cx="5" cy="5" r="2.5" fill={fill} /><circle cx="19" cy="19" r="2.5" fill={secondary} stroke={secondary} /><path d="m10 3 2 2-2 2" /></>,
    library: <><path d="m3 8 9-5 9 5-9 5Z" fill={fill} /><path d="m3 12 9 5 9-5" /><path d="m3 16 9 5 9-5" stroke={secondary} /></>,
    sliders: <><path d="M3 6h18M3 12h18M3 18h18" /><rect x="6" y="3.5" width="4" height="5" rx="1.5" fill={fill} /><rect x="14" y="9.5" width="4" height="5" rx="1.5" fill={secondary} stroke={secondary} /><rect x="7" y="15.5" width="4" height="5" rx="1.5" fill={fill} /></>,
    space: <><path d="M3 8V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" fill={fill} /><path d="M3 8h18" /><path d="M12 12v5m-2.5-2.5h5" stroke={secondary} /></>,
    document: <><path d="M14 2.5H6a2 2 0 0 0-2 2v15a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-11Z" fill={fill} /><path d="M14 2.5v6h6M8 12h8M8 16h5" /><path d="M8 7h2" stroke={secondary} /></>,
    folder: <><path d="M3 10V6a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v2" /><path d="M5 10h15a1.5 1.5 0 0 1 1.5 2l-2 7a2 2 0 0 1-2 1.5H4A2 2 0 0 1 2 18l1.5-6.5A1.5 1.5 0 0 1 5 10Z" fill={fill} /><path d="M8 14h7" stroke={secondary} /></>,
    search: <><circle cx="10.5" cy="10.5" r="7" fill={fill} /><path d="m16 16 5 5" stroke={secondary} /><path d="M7 10a3.5 3.5 0 0 1 3.5-3" /></>,
    image: <><rect x="3" y="3" width="18" height="18" rx="3" fill={fill} /><circle cx="8" cy="8" r="1.5" fill={secondary} stroke={secondary} /><path d="m3 17 5-5 4 4 4-7 5 6" /></>,
    audio: <><path d="M9 17V5l11-2v12M9 8l11-2" /><ellipse cx="6" cy="18" rx="3" ry="3" fill={fill} /><ellipse cx="17" cy="16" rx="3" ry="3" fill={secondary} stroke={secondary} /></>,
    video: <><rect x="2.5" y="5" width="14" height="14" rx="3" fill={fill} /><path d="m16.5 10 5-3v10l-5-3" /><path d="m8 9 4 3-4 3Z" fill={secondary} stroke={secondary} /></>,
    conversation: <><path d="M5 4h14a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H9l-6 3V6a2 2 0 0 1 2-2Z" fill={fill} /><path d="M7.5 9h9m-9 5h5" stroke={secondary} /></>,
  }
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className={`dialog-glyph ${className}`} data-glyph={name} aria-hidden="true" focusable="false">{artwork[name]}</svg>
}
