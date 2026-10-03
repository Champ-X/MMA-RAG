import { useId, useLayoutEffect, useRef, useState } from 'react'
import './connectorLayer.css'

type Anchor = 'left' | 'right' | 'top' | 'bottom'
type Point = { x: number; y: number }
type NodeRect = { left: number; top: number; right: number; bottom: number; width: number; height: number }

export interface ConnectionSpec {
  id: string
  from: string
  to: string
  tone?: 'accent' | 'teal' | 'blue' | 'amber'
  endTone?: 'accent' | 'teal' | 'blue' | 'amber'
  status?: 'upcoming' | 'active' | 'complete'
  dashed?: boolean
  label?: string
  bidirectional?: boolean
  fromAnchor?: Anchor
  toAnchor?: Anchor
  /** Route through a reserved corridor inside the diagram's left or right edge. */
  via?: 'left' | 'right'
  viaInset?: number
}

function anchorPoint(rect: NodeRect, side: Anchor, shift = 0): Point {
  const gap = 6
  if (side === 'left') return { x: rect.left - gap, y: rect.top + rect.height / 2 + shift }
  if (side === 'right') return { x: rect.right + gap, y: rect.top + rect.height / 2 + shift }
  if (side === 'top') return { x: rect.left + rect.width / 2 + shift, y: rect.top - gap }
  return { x: rect.left + rect.width / 2 + shift, y: rect.bottom + gap }
}

function coordinates(point: Point) { return `${point.x.toFixed(2)} ${point.y.toFixed(2)}` }

function cubicPoint(start: Point, first: Point, second: Point, end: Point, t: number): Point {
  const r = 1 - t
  return { x: r ** 3 * start.x + 3 * r ** 2 * t * first.x + 3 * r * t ** 2 * second.x + t ** 3 * end.x,
    y: r ** 3 * start.y + 3 * r ** 2 * t * first.y + 3 * r * t ** 2 * second.y + t ** 3 * end.y }
}

/** Side corridors retain their clearance; their bends are sampled for the ribbon outline. */
function roundedTrack(points: Point[]) {
  const clean = points.filter((point, i) => !i || point.x !== points[i - 1].x || point.y !== points[i - 1].y)
  const samples = [clean[0]]
  let path = `M ${coordinates(clean[0])}`
  const lineTo = (end: Point) => {
    const start = samples[samples.length - 1]
    const count = Math.max(1, Math.ceil(Math.hypot(end.x - start.x, end.y - start.y) / 4))
    for (let i = 1; i <= count; i++) samples.push({ x: start.x + (end.x - start.x) * i / count, y: start.y + (end.y - start.y) * i / count })
  }
  for (let i = 1; i < clean.length - 1; i += 1) {
    const previous = clean[i - 1]
    const corner = clean[i]
    const next = clean[i + 1]
    const incoming = Math.hypot(corner.x - previous.x, corner.y - previous.y)
    const outgoing = Math.hypot(next.x - corner.x, next.y - corner.y)
    const radius = Math.min(18, incoming / 2, outgoing / 2)
    const before = { x: corner.x + (previous.x - corner.x) * radius / incoming, y: corner.y + (previous.y - corner.y) * radius / incoming }
    const after = { x: corner.x + (next.x - corner.x) * radius / outgoing, y: corner.y + (next.y - corner.y) * radius / outgoing }
    lineTo(before)
    for (let j = 1; j <= 12; j++) {
      const t = j / 12
      samples.push({ x: (1 - t) ** 2 * before.x + 2 * (1 - t) * t * corner.x + t ** 2 * after.x, y: (1 - t) ** 2 * before.y + 2 * (1 - t) * t * corner.y + t ** 2 * after.y })
    }
    path += ` L ${coordinates(before)} Q ${coordinates(corner)} ${coordinates(after)}`
  }
  const last = clean[clean.length - 1]
  lineTo(last)
  return { path: `${path} L ${coordinates(last)}`, samples }
}

/** The shaft and sculpted point are one closed silhouette, never an attached icon. */
function ribbonSilhouette(points: Point[], halfWidth: number, tipLength = 15) {
  if (points.length < 2) return ''
  const lengths = [0]
  for (let i = 1; i < points.length; i++) lengths.push(lengths[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y))
  const length = lengths[lengths.length - 1]
  if (!Number.isFinite(length) || length < .01) return ''
  const head = Math.min(tipLength, length * .22)
  const neck = length - head
  const upper: Point[] = []
  const lower: Point[] = []
  // Equal arc-length samples keep taper and arrow proportions stable on every curve.
  const at = (distance: number) => {
    const boundedDistance = Math.max(0, Math.min(length, distance))
    const index = Math.max(1, lengths.findIndex(value => value >= boundedDistance))
    const a = points[index - 1], b = points[index]
    const segment = lengths[index] - lengths[index - 1] || 1
    const t = (boundedDistance - lengths[index - 1]) / segment
    const dx = (b.x - a.x) / segment, dy = (b.y - a.y) / segment
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, nx: -dy, ny: dx }
  }
  const count = Math.max(32, Math.ceil(length / 2))
  for (let i = 0; i <= count; i++) {
    const distance = length * i / count
    const point = at(distance)
    const pressure = .12 + .88 * Math.sin(Math.PI * .5 * Math.min(1, distance / Math.max(1, neck * .4)))
    const opening = Math.max(0, Math.min(1, (distance - neck * .6) / Math.max(1, neck * .4)))
    const easedOpening = opening * opening * (3 - 2 * opening)
    const width = distance < neck
      ? halfWidth * pressure * (.38 + .97 * easedOpening)
      : halfWidth * 1.35 * Math.sin(Math.PI * .5 * Math.max(0, (length - distance) / head))
    upper.push({ x: point.x + point.nx * width, y: point.y + point.ny * width })
    lower.push({ x: point.x - point.nx * width * .7, y: point.y - point.ny * width * .7 })
  }
  return `M ${upper.map(coordinates).join(' L ')} L ${lower.reverse().map(coordinates).join(' L ')} Z`
}

function trackGeometry(spec: ConnectionSpec, from: NodeRect, to: NodeRect, width: number, shift = 0, bow = 0) {
  // Horizontal separation takes precedence even when the next column starts higher.
  const horizontal = to.left >= from.right || from.left >= to.right
  const fromSide = spec.fromAnchor ?? (horizontal ? (to.left >= from.right ? 'right' : 'left') : (to.top >= from.bottom ? 'bottom' : 'top'))
  const toSide = spec.toAnchor ?? (horizontal ? (to.left >= from.right ? 'left' : 'right') : (to.top >= from.bottom ? 'top' : 'bottom'))
  const start = anchorPoint(from, fromSide, shift)
  const end = anchorPoint(to, toSide, shift)
  const horizontalTrack = fromSide === 'left' || fromSide === 'right'
  let curve: { path: string; samples: Point[] }
  if (spec.via) {
    const x = spec.via === 'left' ? (spec.viaInset ?? 16) : width - (spec.viaInset ?? 16)
    curve = roundedTrack([start, { x, y: start.y }, { x, y: end.y }, end])
  } else {
    const bend = horizontalTrack ? (end.x - start.x) * .52 : (end.y - start.y) * .52
    const arc = bow || (horizontalTrack && Math.abs(start.y - end.y) < 1 && Math.abs(end.x - start.x) > 48 ? -5 : 0)
    const first = horizontalTrack ? { x: start.x + bend, y: start.y + arc } : { x: start.x + arc, y: start.y + bend }
    const second = horizontalTrack ? { x: end.x - bend, y: end.y + arc } : { x: end.x + arc, y: end.y - bend }
    curve = {
      path: `M ${coordinates(start)} C ${coordinates(first)} ${coordinates(second)} ${coordinates(end)}`,
      samples: Array.from({ length: 65 }, (_, i) => cubicPoint(start, first, second, end, i / 64)),
    }
  }
  const halfWidth = spec.via ? 1.6 : spec.dashed ? 2.1 : spec.bidirectional ? 3.1 : 3.8
  return { start, end, path: curve.path, ribbon: ribbonSilhouette(curve.samples, halfWidth, spec.via ? 6 : 15), horizontal: horizontalTrack }
}

/** Place inside a positioned wrapper; node anchors are measured in SVG CSS pixels. */
export function ConnectorLayer({ connections }: { connections: ConnectionSpec[] }) {
  const svgRef = useRef<SVGSVGElement>(null)
  const id = useId().replace(/:/g, '')
  const [layout, setLayout] = useState<{ width: number; height: number; nodes: Record<string, NodeRect> }>({ width: 0, height: 0, nodes: {} })
  const nodeKey = JSON.stringify([...new Set(connections.flatMap(connection => [connection.from, connection.to]))].sort())

  useLayoutEffect(() => {
    const svg = svgRef.current
    const wrapper = svg?.parentElement
    if (!svg || !wrapper) return
    const nodes = [...wrapper.querySelectorAll<HTMLElement>('[data-connection-node]')]
    let frame = 0
    let disposed = false
    const measure = () => {
      const origin = svg.getBoundingClientRect()
      const next = { width: origin.width, height: origin.height, nodes: {} as Record<string, NodeRect> }
      nodes.forEach(node => {
        const rect = node.getBoundingClientRect()
        if (!rect.width || !rect.height) return
        next.nodes[node.dataset.connectionNode!] = {
          left: rect.left - origin.left, top: rect.top - origin.top,
          right: rect.right - origin.left, bottom: rect.bottom - origin.top,
          width: rect.width, height: rect.height,
        }
      })
      setLayout(previous => JSON.stringify(previous) === JSON.stringify(next) ? previous : next)
    }
    const schedule = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(measure)
    }
    const observer = new ResizeObserver(schedule)
    observer.observe(wrapper)
    nodes.forEach(node => observer.observe(node))
    measure()
    void document.fonts.ready.then(() => { if (!disposed) schedule() })
    return () => { disposed = true; cancelAnimationFrame(frame); observer.disconnect() }
  }, [nodeKey])

  return <svg ref={svgRef} className="atlas-connector-layer" width="100%" height="100%" viewBox={layout.width && layout.height ? `0 0 ${layout.width} ${layout.height}` : undefined} aria-hidden="true" focusable="false">
    {connections.map((connection, index) => {
      const from = layout.nodes[connection.from]
      const to = layout.nodes[connection.to]
      if (!from || !to) return null
      const gradient = `ribbon-${id}-${index}`
      const track = trackGeometry(connection, from, to, layout.width, connection.bidirectional ? -6 : 0, connection.bidirectional ? -12 : 0)
      const reverse = connection.bidirectional ? trackGeometry({ ...connection, fromAnchor: connection.toAnchor, toAnchor: connection.fromAnchor }, to, from, layout.width, 6, 12) : null
      const labelWidth = (connection.label?.length ?? 0) * 12 + 12
      const labelX = (track.start.x + track.end.x) / 2 + (track.horizontal ? 0 : labelWidth / 2 + (connection.bidirectional ? 27 : 12))
      const labelY = (track.start.y + track.end.y) / 2 + (track.horizontal ? (connection.bidirectional ? -25 : -19) : 0)
      return <g key={connection.id} className="atlas-connection" data-connection={connection.id} data-from={connection.from} data-to={connection.to} data-tone={connection.tone ?? 'accent'} data-end-tone={connection.endTone} data-status={connection.status ?? 'complete'} data-dashed={connection.dashed || undefined}>
        {[track, ...(reverse ? [reverse] : [])].map((segment, i) => <g key={i}>
          <defs><linearGradient id={`${gradient}-${i}`} gradientUnits="userSpaceOnUse" x1={segment.start.x} y1={segment.start.y} x2={segment.end.x} y2={segment.end.y}>
            <stop className={i === 0 ? undefined : 'atlas-ribbon-destination'} offset="0" stopColor="currentColor" stopOpacity=".3" /><stop offset=".44" stopColor="currentColor" stopOpacity=".5" /><stop className={i === 0 ? 'atlas-ribbon-destination' : undefined} offset="1" stopColor="currentColor" stopOpacity=".95" />
          </linearGradient></defs>
          <path className="atlas-connector-ribbon" d={segment.ribbon} fill={`url(#${gradient}-${i})`} />
          <path className="atlas-connector-track" d={segment.path} />
          <path className="atlas-connector-packet" d={segment.path} pathLength="100" />
        </g>)}
        {connection.label && <g className="atlas-connector-label" transform={`translate(${labelX} ${labelY})`}><rect x={-labelWidth / 2} y="-11" width={labelWidth} height="22" rx="6" /><text textAnchor="middle" dominantBaseline="central">{connection.label}</text></g>}
      </g>
    })}
  </svg>
}

const shortRibbon = ribbonSilhouette(Array.from({ length: 37 }, (_, i) => ({ x: i + 2, y: 8 })), 2.7)

/** A miniature of the same tapered brush shape, preserving its silhouette at small sizes. */
export function FlowArrow({ className = '', vertical = false }: { className?: string; vertical?: boolean }) {
  const id = `ribbon-short-${useId().replace(/:/g, '')}`
  return <svg className={`atlas-flow-arrow ${className}`} data-vertical={vertical || undefined} viewBox="0 0 40 16" fill="none" aria-hidden="true" focusable="false">
    <defs><linearGradient id={id}><stop stopColor="currentColor" stopOpacity=".12" /><stop offset="1" stopColor="currentColor" stopOpacity=".95" /></linearGradient></defs>
    <path d={shortRibbon} fill={`url(#${id})`} /><path className="atlas-flow-arrow-spine" d="M 2 8 H 38" />
  </svg>
}
