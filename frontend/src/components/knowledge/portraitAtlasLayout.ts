import { hierarchy, pack } from 'd3'

interface AtlasCluster {
  cluster_id: string
  cluster_size: number
}

export interface PortraitAtlasNode {
  id: string
  x: number
  y: number
  r: number
}

interface PackDatum {
  id: string
  count: number
  children?: PackDatum[]
}

const positiveDimension = (value: number) => Number.isFinite(value) ? Math.max(1, value) : 1
const positiveCount = (value: number) => Number.isFinite(value) && value > 0 ? value : 1

interface WeightedNode extends PortraitAtlasNode {
  weight: number
}

interface LayoutCandidate {
  nodes: PortraitAtlasNode[]
  radiusScale: number
}

/** Rotate the packed group, then fit its actual circle bounds, not its enclosing disk. */
function fitPackedOrientation(
  nodes: WeightedNode[],
  radiusScale: number,
  angle: number,
  width: number,
  height: number,
  margin: number,
): LayoutCandidate {
  const cosine = Math.cos(angle)
  const sine = Math.sin(angle)
  const rotated = nodes.map(node => ({
    ...node,
    x: node.x * cosine - node.y * sine,
    y: node.x * sine + node.y * cosine,
  }))
  let left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity
  for (const node of rotated) {
    left = Math.min(left, node.x - node.r)
    right = Math.max(right, node.x + node.r)
    top = Math.min(top, node.y - node.r)
    bottom = Math.max(bottom, node.y + node.r)
  }
  const scale = Math.min((width - margin * 2) / (right - left), (height - margin * 2) / (bottom - top))
  const fittedRadiusScale = radiusScale * scale
  const centerX = (left + right) / 2
  const centerY = (top + bottom) / 2
  return {
    radiusScale: fittedRadiusScale,
    nodes: rotated.map(node => ({
      id: node.id,
      x: width / 2 + (node.x - centerX) * scale,
      y: height / 2 + (node.y - centerY) * scale,
      r: node.weight * fittedRadiusScale,
    })),
  }
}

function bestRotatedLayout(
  nodes: WeightedNode[],
  radiusScale: number,
  width: number,
  height: number,
  margin: number,
): LayoutCandidate {
  let best = fitPackedOrientation(nodes, radiusScale, 0, width, height, margin)
  // One-degree sampling is bounded O(n), deterministic and independent of API
  // ordering. Rotating preserves distances; uniform fitting preserves area ratios.
  for (let degrees = 1; degrees < 180; degrees += 1) {
    const candidate = fitPackedOrientation(nodes, radiusScale, degrees * Math.PI / 180, width, height, margin)
    if (candidate.radiusScale / best.radiusScale > 1 + 1e-12) best = candidate
  }
  return best
}

/** A row or column can fit a few topics better than a circular envelope. */
function fitLinearLayout(
  nodes: WeightedNode[],
  width: number,
  height: number,
  margin: number,
  gap: number,
  horizontal: boolean,
): LayoutCandidate | null {
  const longSide = (horizontal ? width : height) - margin * 2
  const shortSide = (horizontal ? height : width) - margin * 2
  const availableLength = longSide - gap * (nodes.length - 1)
  if (availableLength <= 0) return null
  const weightSum = nodes.reduce((sum, node) => sum + node.weight, 0)
  const maxWeight = nodes[0].weight
  const radiusScale = Math.min(availableLength / (2 * weightSum), shortSide / (2 * maxWeight))
  const extent = 2 * weightSum * radiusScale + gap * (nodes.length - 1)
  let cursor = margin + (longSide - extent) / 2
  return {
    radiusScale,
    nodes: nodes.map(node => {
      const r = node.weight * radiusScale
      const center = cursor + r
      cursor += 2 * r + gap
      return { id: node.id, x: horizontal ? center : width / 2, y: horizontal ? height / 2 : center, r }
    }),
  }
}

/**
 * Fit topics to the viewport using the largest common area scale among a rotated
 * circle packing and deterministic row/column candidates. Every positive count uses the same
 * area scale; small topics are never inflated independently of larger topics.
 * Invalid/empty counts receive a one-sample placeholder so they remain visible.
 */
export function layoutPortraitClusters(
  clusters: AtlasCluster[],
  width: number,
  height: number,
): PortraitAtlasNode[] {
  if (clusters.length === 0) return []

  const safeWidth = positiveDimension(width)
  const safeHeight = positiveDimension(height)
  // Keep 20px around a normal chart, while still handling a hidden/tiny host.
  const margin = Math.min(20, safeWidth / 4, safeHeight / 4)
  const innerWidth = safeWidth - margin * 2
  const innerHeight = safeHeight - margin * 2
  const gap = Math.min(14, Math.min(innerWidth, innerHeight) / 10)
  const children = clusters.map((cluster) => ({
    id: cluster.cluster_id,
    count: positiveCount(cluster.cluster_size),
  }))
  const maxCount = children.reduce((max, child) => Math.max(max, child.count), children[0].count)
  const root = hierarchy<PackDatum>({ id: '', count: 0, children })
    // Normalization avoids overflowing the sum for large sample counts.
    .sum((datum) => datum.count / maxCount)
    .sort((a, b) => b.data.count - a.data.count || (a.data.id < b.data.id ? -1 : a.data.id > b.data.id ? 1 : 0))

  const nodes = pack<PackDatum>()
    .size([innerWidth, innerHeight])
    .padding(gap)(root)
    .leaves()
  // Packing adds and removes padding. Recompute radii from one common scale to
  // avoid cancellation rounding tiny positive circles down to zero.
  const radiusScale = nodes[0].r / Math.sqrt(nodes[0].data.count)
  const seeds: WeightedNode[] = nodes.map((node) => ({
    id: node.data.id,
    x: node.x - innerWidth / 2,
    y: node.y - innerHeight / 2,
    r: Math.sqrt(node.data.count) * radiusScale,
    weight: Math.sqrt(node.data.count),
  }))
  let best = bestRotatedLayout(seeds, radiusScale, safeWidth, safeHeight, margin)
  for (const horizontal of [true, false]) {
    const linear = fitLinearLayout(seeds, safeWidth, safeHeight, margin, gap, horizontal)
    if (!linear) continue
    const linearSeeds = linear.nodes.map((node, index) => ({
      ...node,
      x: node.x - safeWidth / 2,
      y: node.y - safeHeight / 2,
      weight: seeds[index].weight,
    }))
    const candidate = bestRotatedLayout(linearSeeds, linear.radiusScale, safeWidth, safeHeight, margin)
    if (candidate.radiusScale / best.radiusScale > 1 + 1e-12) best = candidate
  }
  return best.nodes
}
