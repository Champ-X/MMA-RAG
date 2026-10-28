import { curveBasisClosed, line, packSiblings, polygonHull } from 'd3'

interface TopicCluster {
  cluster_id: string
  cluster_size: number
  title?: string
  keywords?: string[]
}

export interface TopicConstellationBounds {
  x: number
  y: number
  width: number
  height: number
}

export interface TopicConstellationPoint {
  x: number
  y: number
  weight: number
}

export interface TopicConstellation {
  id: string
  x: number
  y: number
  rx: number
  ry: number
  /** Text baselines, relative to the island's centre. */
  labelY: number
  countY: number
  keywordY: number
  /** Slightly larger member marks when a small set of topics has room to breathe. */
  dotScale: number
  points: TopicConstellationPoint[]
  outline: string
  /** Visible geometry and click target, both relative to the island centre. */
  contentBounds: TopicConstellationBounds
  hitBounds: TopicConstellationBounds
}

const dimension = (value: number) => Number.isFinite(value) ? Math.max(1, value) : 1
// Counts are discrete samples. Fractions are floored; unsafe counts are capped
// before splitting them into exact integer weights.
const sampleCount = (value: number) => Number.isFinite(value) && value > 0
  ? Math.min(Number.MAX_SAFE_INTEGER, Math.floor(value)) : 0

/** Fit the exploration surface to its topic count instead of reserving 500px. */
export function getTopicConstellationHeight(topicCount: number, width: number): number {
  const count = Number.isFinite(topicCount) ? Math.max(1, Math.floor(topicCount)) : 1
  const base = count <= 2 ? 250 + count * 20
    : count <= 4 ? 280 + count * 20
      : count === 5 ? 440
        : count <= 8 ? 480
      : Math.min(560, count <= 11 ? Math.max(480, 280 + count * 20) : 500 + (count - 11) * 10)
  const wideRelief = count <= 5 ? Math.round(Math.min(20, Math.max(0, dimension(width) - 960) / 12) / 10) * 10 : 0
  return Math.max(260, base - wideRelief)
}

function seededRandom(id: string) {
  let state = 2166136261
  for (let i = 0; i < id.length; i += 1) state = Math.imul(state ^ id.charCodeAt(i), 16777619)
  return () => {
    state += 0x6D2B79F5
    let value = state
    value = Math.imul(value ^ value >>> 15, value | 1)
    value ^= value + Math.imul(value ^ value >>> 7, value | 61)
    return ((value ^ value >>> 14) >>> 0) / 4294967296
  }
}

function islandPoints(id: string, count: number, rx: number, ry: number, expansion: number, dotScale: number): TopicConstellationPoint[] {
  const length = Math.min(80, count)
  if (!length) return []
  const random = seededRandom(id)
  const spreadX = Math.min(rx * 0.78, (12 + Math.sqrt(length) * 9) * expansion)
  const spreadY = Math.min(ry * 0.52, (6 + Math.sqrt(length) * 6) * expansion)
  const centerY = ry * 0.28
  const textScale = Math.min(1, ry / 65)
  const cloudTop = Math.max(-ry * 0.25, -ry + 55 * textScale)
  const cloudBottom = ry * 0.76
  const minimumGap = Math.min(9.4 * dotScale, Math.sqrt(Math.PI * spreadX * spreadY / length) * 0.72)
  const baseWeight = Math.floor(count / length)
  const extra = count % length
  const points: TopicConstellationPoint[] = []

  for (let index = 0; index < length; index += 1) {
    let best = { x: 0, y: centerY }
    let bestDistance = -1
    // A single density centre with seeded Gaussian variation. Rejection keeps
    // dots in the lower cloud, and spacing avoids coincident sample markers.
    for (let attempt = 0; attempt < 160; attempt += 1) {
      const radius = Math.sqrt(-2 * Math.log(Math.max(Number.EPSILON, random()))) * 0.46
      const angle = random() * Math.PI * 2
      const nx = Math.cos(angle) * radius
      const ny = Math.sin(angle) * radius
      if (nx * nx + ny * ny > 1) continue
      const candidate = { x: nx * spreadX, y: centerY + ny * spreadY }
      if (candidate.y < cloudTop || candidate.y > cloudBottom) continue
      if (Math.hypot(candidate.x / rx, candidate.y / ry) > 0.94) continue
      const distance = points.reduce((nearest, point) => Math.min(nearest,
        Math.hypot(candidate.x - point.x, candidate.y - point.y)), Infinity)
      if (distance > bestDistance) { best = candidate; bestDistance = distance }
      if (distance >= minimumGap) break
    }
    points.push({ ...best, weight: baseWeight + (index < extra ? 1 : 0) })
  }
  // A finite Gaussian draw can leave an accidentally flat ribbon. Use the
  // reserved vertical space before shrinking it horizontally; this changes
  // only the illustrative cloud, never island centres or sample membership.
  if (length > 4) {
    const minX = Math.min(...points.map(point => point.x))
    const maxX = Math.max(...points.map(point => point.x))
    const minY = Math.min(...points.map(point => point.y))
    const maxY = Math.max(...points.map(point => point.y))
    if (maxX - minX > (maxY - minY) * 2.55 && maxY > minY) {
      const targetHeight = Math.min(cloudBottom - cloudTop, (maxX - minX) / 2.55)
      const targetMid = Math.max(cloudTop + targetHeight / 2, Math.min(cloudBottom - targetHeight / 2, (minY + maxY) / 2))
      const horizontalScale = Math.min(1, targetHeight * 2.55 / (maxX - minX))
      for (const point of points) {
        point.x *= horizontalScale
        point.y = targetMid + (point.y - (minY + maxY) / 2) * targetHeight / (maxY - minY)
      }
    }
  }
  return points
}

function islandOutline(island: Pick<TopicConstellation, 'rx' | 'ry' | 'points'>): string {
  const { rx, ry, points } = island
  if (!points.length) return ''
  const anchors: [number, number][] = []
  // Outline the actual cloud alone: labels sit outside its upper/lower edges.
  // All anchors stay within the non-overlapping packing ellipse.
  function anchor(x: number, y: number) {
    const distance = Math.hypot(x / rx, y / ry)
    const scale = distance > 1 ? 1 / distance : 1
    anchors.push([x * scale, y * scale])
  }
  for (const point of points) {
    const padding = Math.min(9, rx * 0.09, ry * 0.13)
    for (let i = 0; i < 8; i += 1) {
      const angle = i * Math.PI / 4
      anchor(point.x + Math.cos(angle) * padding, point.y + Math.sin(angle) * padding)
    }
  }
  const hull = polygonHull(anchors)
  const path = hull ? line<[number, number]>().curve(curveBasisClosed)(hull) : null
  return path ? `${path}Z` : ''
}

function textWidth(text: string, fontSize: number) {
  return [...text].reduce((width, character) => width + fontSize * (/[^\u0000-\u00ff]/.test(character) ? 1 : /\s/.test(character) ? 0.32 : 0.6), 0)
}

function islandBounds(island: Pick<TopicConstellation, 'points' | 'labelY' | 'countY' | 'dotScale'>, cluster: TopicCluster) {
  const title = cluster.title || cluster.keywords?.[0] || '主题'
  const countText = `${sampleCount(cluster.cluster_size).toLocaleString('en-US')} 样本${cluster.keywords?.length ? ` · ${cluster.keywords.slice(1, 3).join(' / ')}` : ''}`
  // Reserve the selected checkmark without moving neighbours on selection.
  // Long text uses the same bounded one-line treatment as the cluster labels.
  const titleWidth = Math.min(180, Math.max(44, textWidth(title, 21) + 19))
  const captionWidth = Math.min(180, Math.max(44, textWidth(countText, 11)))
  const textHalfWidth = Math.max(titleWidth, captionWidth) / 2
  const padding = Math.max(9, 6 * island.dotScale + 2)
  const left = Math.min(-textHalfWidth, ...island.points.map(point => point.x - padding))
  const right = Math.max(textHalfWidth, ...island.points.map(point => point.x + padding))
  const top = Math.min(island.labelY - 23, island.countY - 11, ...island.points.map(point => point.y - padding))
  const bottom = Math.max(island.labelY + 5, island.countY + 5, ...island.points.map(point => point.y + padding))
  const contentBounds = { x: left, y: top, width: right - left, height: bottom - top }
  const hitBounds = { x: left - 5, y: top - 5, width: right - left + 10, height: bottom - top + 10 }
  return { contentBounds, hitBounds }
}

/** Contract spare space without shrinking clouds or crossing their click targets. */
function gatherIslands(islands: TopicConstellation[], width: number, height: number, margin: number) {
  if (!islands.length) return islands
  const totalArea = islands.reduce((sum, island) => sum + island.contentBounds.width * island.contentBounds.height, 0)
  const centre = islands.reduce((sum, island) => {
    const bounds = island.contentBounds
    const area = bounds.width * bounds.height
    return { x: sum.x + (island.x + bounds.x + bounds.width / 2) * area / totalArea,
      y: sum.y + (island.y + bounds.y + bounds.height / 2) * area / totalArea }
  }, { x: 0, y: 0 })
  const targetX = Math.min(0.76, Math.max(0.5, 1000 / width))
  const targetY = 0.76
  const gap = 8
  let best: { x: number; y: number; cost: number } | undefined
  // Horizontal space is often the real excess. If a vertical neighbour is
  // already close, retain its clearance instead of squeezing its title.
  for (let step = 0; step <= 36; step += 1) {
    const scaleX = targetX + step * 0.01
    let scaleY = targetY
    for (let i = 0; i < islands.length; i += 1) {
      for (const b of islands.slice(i + 1)) {
        const a = islands[i]
        const dx = b.x - a.x
        const dy = b.y - a.y
        const ab = a.hitBounds
        const bb = b.hitBounds
        const requiredX = dx >= 0 ? ab.x + ab.width - bb.x + gap : bb.x + bb.width - ab.x + gap
        if (Math.abs(dx) * scaleX >= requiredX) continue
        const requiredY = dy >= 0 ? ab.y + ab.height - bb.y + gap : bb.y + bb.height - ab.y + gap
        scaleY = Math.max(scaleY, Math.abs(dy) > 1e-10 ? requiredY / Math.abs(dy) : Infinity)
      }
    }
    if (!Number.isFinite(scaleY) || scaleY > 1.12) continue
    const bounds = islands.map(island => ({
      left: centre.x + (island.x - centre.x) * scaleX + island.hitBounds.x,
      top: centre.y + (island.y - centre.y) * scaleY + island.hitBounds.y,
      width: island.hitBounds.width, height: island.hitBounds.height,
    }))
    const spanX = Math.max(...bounds.map(box => box.left + box.width)) - Math.min(...bounds.map(box => box.left))
    const spanY = Math.max(...bounds.map(box => box.top + box.height)) - Math.min(...bounds.map(box => box.top))
    if (spanX > width - margin * 2 || spanY > height - margin * 2) continue
    const cost = (scaleX - targetX) ** 2 + (scaleY - targetY) ** 2
    if (!best || cost < best.cost) best = { x: scaleX, y: scaleY, cost }
  }
  const gathered = islands.map(island => ({ ...island,
    x: centre.x + (island.x - centre.x) * (best?.x ?? 1),
    y: centre.y + (island.y - centre.y) * (best?.y ?? 1),
  }))
  const left = Math.min(...gathered.map(island => island.x + island.hitBounds.x))
  const right = Math.max(...gathered.map(island => island.x + island.hitBounds.x + island.hitBounds.width))
  const top = Math.min(...gathered.map(island => island.y + island.hitBounds.y))
  const bottom = Math.max(...gathered.map(island => island.y + island.hitBounds.y + island.hitBounds.height))
  return gathered.map(island => ({ ...island, x: island.x + (width - left - right) / 2, y: island.y + (height - top - bottom) / 2 }))
}

/**
 * Deterministic decorative clustering, not an embedding projection or semantic
 * distance model. Integer samples are individual dots up to 80; larger groups
 * retain exact totals through integer point weights.
 */
export function layoutTopicConstellations(
  clusters: TopicCluster[], width: number, height: number,
): TopicConstellation[] {
  if (!clusters.length) return []
  const safeWidth = dimension(width)
  const safeHeight = dimension(height)
  const margin = Math.min(18, safeWidth * 0.06, safeHeight * 0.06)
  const circles = clusters.map(cluster => ({
    id: cluster.cluster_id,
    count: sampleCount(cluster.cluster_size),
    r: 1 + Math.sqrt(Math.min(80, sampleCount(cluster.cluster_size))) * 0.035,
    x: 0, y: 0,
  })).sort((a, b) => b.count - a.count || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  packSiblings(circles)

  // Retain an unmistakably two-dimensional, oblique packing rather than
  // optimizing back into horizontal rows. Only centres expand across wide
  // canvases; each cloud has its own pixel-space spread cap above.
  const angle = 18 * Math.PI / 180
  const nodes = circles.map(node => ({ ...node,
    x: node.x * Math.cos(angle) - node.y * Math.sin(angle),
    y: node.x * Math.sin(angle) + node.y * Math.cos(angle),
  }))
  const left = Math.min(...nodes.map(node => node.x - node.r))
  const right = Math.max(...nodes.map(node => node.x + node.r))
  const top = Math.min(...nodes.map(node => node.y - node.r))
  const bottom = Math.max(...nodes.map(node => node.y + node.r))
  const scaleY = (safeHeight - margin * 2) / (bottom - top)
  const scaleX = (safeWidth - margin * 2) / (right - left)
  const horizontalInset = (safeWidth - (right - left) * scaleX) / 2
  const clusterById = new Map(clusters.map(cluster => [cluster.cluster_id, cluster]))
  const islands = nodes.map(node => {
    // The unused packing rim creates space between the organic islands.
    const rx = node.r * scaleX * 0.9
    const ry = node.r * scaleY * 0.9
    const textScale = Math.min(1, ry / 65)
    const dotScale = Math.max(1, Math.min(clusters.length <= 5 ? 1.18 : 1.1, Math.min(rx, ry) / 60))
    const expansion = clusters.length <= 5 ? 1.25 : 1.24
    const points = islandPoints(node.id, node.count, rx, ry, expansion, dotScale)
    const cloudTop = points.length ? Math.min(...points.map(point => point.y)) : 21 * textScale
    const cloudBottom = points.length ? Math.max(...points.map(point => point.y)) : 8 * textScale
    // Attach text to the actual cloud. Two- and four-dot clusters no longer
    // leave their labels stranded at the top of a much larger packing region.
    const labelY = cloudTop - 33 * textScale
    const countY = cloudTop - 15 * textScale
    const keywordY = cloudBottom + Math.min(16, ry * 0.23)
    const island = {
      id: node.id,
      x: horizontalInset + (node.x - left) * scaleX,
      y: margin + (node.y - top) * scaleY,
      rx, ry, labelY,
      countY, keywordY, dotScale, points,
    }
    return { ...island, outline: islandOutline(island), ...islandBounds(island, clusterById.get(node.id)!) }
  })
  return gatherIslands(islands, safeWidth, safeHeight, margin)
}
