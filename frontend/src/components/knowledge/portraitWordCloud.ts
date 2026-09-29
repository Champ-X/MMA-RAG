export interface PortraitWord {
  text: string
  x: number
  y: number
  fontSize: number
  rotation: number
  weight: number
  primary: boolean
}

type MeasureText = (text: string, fontSize: number, weight: number) => number
interface Bounds { left: number; right: number; top: number; bottom: number }

const defaultMeasure: MeasureText = (text, fontSize) => Array.from(text).reduce((width, char) => {
  const factor = /\s/.test(char) ? 0.35 : /[MW@%]/.test(char) ? 0.95 : /[\x00-\x7f]/.test(char) ? 0.7 : 1
  return width + fontSize * factor
}, 0)

function hashString(value: string) {
  let hash = 2166136261
  for (const char of value) hash = Math.imul(hash ^ char.codePointAt(0)!, 16777619)
  return hash >>> 0
}

function intersects(a: Bounds, b: Bounds) {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
}

/** Center-based SVG text placements; render with textAnchor="middle" and dominantBaseline="central". */
export function layoutPortraitWords(
  keywords: string[],
  diameter: number,
  seed: string,
  measureText: MeasureText = defaultMeasure,
): PortraitWord[] {
  if (!Number.isFinite(diameter) || diameter < 32) return []
  const seen = new Set<string>()
  const words = keywords.map(word => word.trim()).filter(word => {
    const key = word.toLocaleLowerCase()
    if (!word || seen.has(key)) return false
    seen.add(key)
    return true
  })
  if (!words.length) return []

  const center = diameter / 2
  const radius = center - 6
  const spacing = diameter < 48 ? 0 : 2
  const occupied: Bounds[] = []
  // The UI omits the count below 48px. Keep the full label slot free otherwise.
  if (diameter >= 48) {
    const halfWidth = Math.min(diameter * 0.55, 80) / 2
    occupied.push({ left: center - halfWidth, right: center + halfWidth, top: diameter * 0.8 - 9, bottom: diameter * 0.8 + 9 })
  }
  const result: PortraitWord[] = []
  const usedLabels = new Set<string>()
  const measuredWidths = new Map<string, number>()
  const seedHash = hashString(seed)

  function fit(word: PortraitWord) {
    const measureKey = `${word.fontSize}:${word.weight}:${word.text}`
    let width = measuredWidths.get(measureKey)
    if (width === undefined) {
      const measured = measureText(word.text, word.fontSize, word.weight)
      width = Number.isFinite(measured) && measured > 0 ? measured : defaultMeasure(word.text, word.fontSize, word.weight)
      measuredWidths.set(measureKey, width)
    }
    const halfWidth = width / 2 + spacing
    const halfHeight = word.fontSize * 0.6 + spacing / 2
    const angle = word.rotation * Math.PI / 180
    const cos = Math.cos(angle)
    const sin = Math.sin(angle)
    const corners = [[-halfWidth, -halfHeight], [halfWidth, -halfHeight], [halfWidth, halfHeight], [-halfWidth, halfHeight]]
      .map(([x, y]) => ({ x: word.x + x * cos - y * sin, y: word.y + x * sin + y * cos }))
    if (corners.some(point => Math.hypot(point.x - center, point.y - center) > radius)) return null
    const bounds = {
      left: Math.min(...corners.map(point => point.x)),
      right: Math.max(...corners.map(point => point.x)),
      top: Math.min(...corners.map(point => point.y)),
      bottom: Math.max(...corners.map(point => point.y)),
    }
    return occupied.some(other => intersects(bounds, other)) ? null : bounds
  }

  function place(text: string, primary: boolean, index: number) {
    const baseSize = primary ? Math.max(12, Math.min(28, Math.round(diameter * (diameter < 120 ? 0.16 : 0.18)))) : Math.max(10, Math.min(14, Math.round(diameter * 0.065) - index % 2))
    const minSize = primary && diameter >= 48 ? 12 : 10
    const baseRotation = primary
      ? diameter >= 80 ? [0, -6, 6][seedHash % 3] : 0
      : [-16, 16, -28, 28, 0, 90, 16, -16][index % 8]
    const rotations = baseRotation === 90 && diameter < 140 ? [-28, 0] : [baseRotation, 0].filter((value, i, all) => all.indexOf(value) === i)
    const anchors = [[0.5, 0.22], [0.28, 0.55], [0.72, 0.54], [0.43, 0.65], [0.7, 0.29], [0.18, 0.43], [0.62, 0.65], [0.35, 0.29]]
    const anchor = anchors[index % anchors.length]
    const positions = primary
      ? [0.43, 0.44, 0.4, 0.46, 0.5].map(y => ({ x: center, y: diameter * y }))
      : [
        // Compact charts have a narrow usable strip above the count label.
        // Explicit anchors keep that strip reachable without dense sampling.
        ...(diameter < 128 ? [[0.5, 0.2], [0.34, 0.635], [0.66, 0.635], [0.5, 0.635]].map(([x, y]) => ({ x: diameter * x, y: diameter * y })) : []),
        ...Array.from({ length: 181 }, (_, step) => {
          const distance = step === 0 ? 0 : Math.sqrt(step / 180) * diameter * 0.55
          const angle = step * 2.3999632297 + (seedHash % 360) * Math.PI / 180
          return { x: anchor[0] * diameter + Math.cos(angle) * distance, y: anchor[1] * diameter + Math.sin(angle) * distance }
        }),
      ]
    const chars = Array.from(text)
    const variants = [text]
    // Prefer every complete word at a smaller size before shortening it.
    for (let length = chars.length - 1; length >= 1; length -= 1) variants.push(`${chars.slice(0, length).join('')}…`)
    // On a 32px dot a single real character may fit while its ellipsis cannot.
    if (primary && diameter < 48 && chars.length > 1) variants.push(chars[0])

    for (const label of variants) {
      if (usedLabels.has(label)) continue
      for (let fontSize = baseSize; fontSize >= minSize; fontSize -= 1) {
        for (const rotation of rotations) {
          for (const point of positions) {
            const word: PortraitWord = { text: label, ...point, fontSize, rotation, weight: primary ? 650 : 500, primary }
            const bounds = fit(word)
            if (!bounds) continue
            occupied.push(bounds)
            usedLabels.add(label)
            result.push(word)
            return
          }
        }
      }
    }
  }

  place(words[0], true, 0)
  if (diameter < 80 || result.length === 0) return result
  const secondaryLimit = Math.min(8, Math.max(3, Math.floor(diameter / 26)))
  words.slice(1, secondaryLimit + 1).forEach((word, index) => place(word, false, index))
  return result
}
