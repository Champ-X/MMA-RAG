import { useId, useLayoutEffect, useRef, useState } from 'react'

type Source = { id: string; left: number; top: number; right: number; bottom: number }
type Layout = { width: number; height: number; sources: Source[]; target: { x: number; y: number } }

/** A measured confluence: upper rows travel outside the cards before joining below. */
export function EvidenceConfluence() {
  const svgRef = useRef<SVGSVGElement>(null)
  const id = useId().replace(/:/g, '')
  const [layout, setLayout] = useState<Layout | null>(null)

  useLayoutEffect(() => {
    const svg = svgRef.current
    const wrapper = svg?.parentElement
    if (!svg || !wrapper) return
    const sources = [...wrapper.querySelectorAll<HTMLElement>('[data-confluence-source]')]
    const target = wrapper.querySelector<HTMLElement>('[data-confluence-target]')
    if (!target) return
    let frame = 0
    let disposed = false
    const measure = () => {
      const origin = svg.getBoundingClientRect()
      const destination = target.getBoundingClientRect()
      const next: Layout = {
        width: origin.width,
        height: origin.height,
        target: { x: destination.left - origin.left, y: destination.top - origin.top },
        sources: sources.map(source => {
          const rect = source.getBoundingClientRect()
          return { id: source.dataset.confluenceSource!, left: rect.left - origin.left, top: rect.top - origin.top, right: rect.right - origin.left, bottom: rect.bottom - origin.top }
        }),
      }
      setLayout(previous => JSON.stringify(previous) === JSON.stringify(next) ? previous : next)
    }
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(measure) }
    const observer = new ResizeObserver(schedule)
    ;[wrapper, target, ...sources].forEach(node => observer.observe(node))
    measure()
    void document.fonts.ready.then(() => { if (!disposed) schedule() })
    return () => { disposed = true; observer.disconnect(); cancelAnimationFrame(frame) }
  }, [])

  const lastRow = Math.max(...(layout?.sources.map(source => source.top) ?? [0]))
  const lowestEdge = Math.max(...(layout?.sources.map(source => source.bottom) ?? [0]))

  return <svg ref={svgRef} className="atlas-evidence-confluence" width="100%" height="100%" viewBox={layout?.width ? `0 0 ${layout.width} ${layout.height}` : undefined} aria-hidden="true" focusable="false">
    {layout?.sources.map((source, index) => {
      const { x, y } = layout.target
      let startX = (source.left + source.right) / 2
      let startY = source.bottom + 2
      let path: string
      if (source.top < lastRow - 8) {
        const left = startX < layout.width / 2 - 1
        startX = left ? source.left - 1 : source.right + 1
        startY = (source.top + source.bottom) / 2
        const corridor = left ? Math.max(4, startX - 15) : Math.min(layout.width - 4, startX + 15)
        path = `M ${startX} ${startY} C ${corridor} ${startY}, ${corridor} ${startY + 14}, ${corridor} ${startY + 28} L ${corridor} ${lowestEdge + 3} C ${corridor} ${lowestEdge + 30}, ${x} ${y - 17}, ${x} ${y}`
      } else {
        const height = y - startY
        path = `M ${startX} ${startY} C ${startX} ${startY + height * .52}, ${x} ${y - height * .3}, ${x} ${y}`
      }
      const gradient = `confluence-${id}-${index}`
      return <g key={source.id} className="atlas-confluence-ribbon" data-tone={source.id}>
        <defs><linearGradient id={gradient} gradientUnits="userSpaceOnUse" x1={startX} y1={startY} x2={x} y2={y}><stop stopColor="currentColor" stopOpacity=".1" /><stop offset="1" stopColor="currentColor" stopOpacity=".26" /></linearGradient></defs>
        <path className="atlas-confluence-body" d={path} stroke={`url(#${gradient})`} />
        <path className="atlas-confluence-spine" d={path} />
      </g>
    })}
  </svg>
}
