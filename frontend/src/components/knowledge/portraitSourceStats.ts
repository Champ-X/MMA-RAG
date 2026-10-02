export interface PortraitSourceCounts {
  textCount: number
  imageCount: number
  audioCount: number
  videoShotCount: number
}

export type PortraitSourceKind = 'text' | 'image' | 'audio' | 'video'

export function normalizePortraitCount(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0
}

/** Only comparable content samples enter the denominator, never topics or files. */
export function buildPortraitSourceStats(counts: PortraitSourceCounts) {
  const sources = [
    { kind: 'text' as const, label: '文本块', count: normalizePortraitCount(counts.textCount), color: '#4266df' },
    { kind: 'image' as const, label: '图片', count: normalizePortraitCount(counts.imageCount), color: '#0b967f' },
    { kind: 'audio' as const, label: '音频', count: normalizePortraitCount(counts.audioCount), color: '#a647ce' },
    { kind: 'video' as const, label: '视频片段', count: normalizePortraitCount(counts.videoShotCount), color: '#df6c2b' },
  ]
  const total = sources.reduce((sum, source) => sum + source.count, 0)
  let offset = 0
  const segments = sources.map(source => {
    const percentage = total > 0 ? source.count / total * 100 : 0
    const segment = { ...source, percentage, offset }
    offset += percentage
    return segment
  })
  return { total, segments }
}

export function formatPortraitPercentage(percentage: number): string {
  if (percentage > 0 && percentage < 0.1) return '<0.1%'
  return `${Number(percentage.toFixed(1))}%`
}
