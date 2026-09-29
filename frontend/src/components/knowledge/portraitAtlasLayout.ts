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

/**
 * Pack topics inside the available viewport. Every positive count uses the same
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
  const maxCount = children.reduce((max, child) => Math.max(max, child.count), 1)
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
  return nodes.map((node) => ({
    id: node.data.id,
    x: node.x + margin,
    y: node.y + margin,
    r: Math.sqrt(node.data.count) * radiusScale,
  }))
}
