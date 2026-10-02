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

function intersects(a: Bounds, b: Bounds) {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
}

/** Horizontal, center-based SVG text; use textAnchor="middle" and dominantBaseline="central". */
export function layoutPortraitWords(
  keywords: string[],
  diameter: number,
  _seed: string,
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
  // Match the count label's actual footprint; the UI omits it below 48px.
  if (diameter >= 48) {
    const halfWidth = Math.min(diameter * 0.55, 80) / 2
    occupied.push({ left: center - halfWidth, right: center + halfWidth, top: diameter * 0.8 - 9, bottom: diameter * 0.8 + 9 })
  }
  const result: PortraitWord[] = []
  const measuredWidths = new Map<string, number>()

  function width(text: string, fontSize: number, weight: number) {
    const key = fontSize + ':' + weight + ':' + text
    const cached = measuredWidths.get(key)
    if (cached !== undefined) return cached
    const measured = measureText(text, fontSize, weight)
    const value = Number.isFinite(measured) && measured > 0 ? measured : defaultMeasure(text, fontSize, weight)
    measuredWidths.set(key, value)
    return value
  }

  function halfHeight(fontSize: number) {
    return fontSize * 0.6 + spacing / 2
  }

  function rowWidth(y: number, fontSize: number) {
    const verticalExtent = Math.abs(y - center) + halfHeight(fontSize)
    return verticalExtent >= radius ? 0 : 2 * Math.sqrt(radius * radius - verticalExtent * verticalExtent)
  }

  function place(text: string, x: number, y: number, fontSize: number, primary: boolean) {
    const weight = primary ? 650 : 500
    const halfWidth = width(text, fontSize, weight) / 2 + spacing
    const box = { left: x - halfWidth, right: x + halfWidth, top: y - halfHeight(fontSize), bottom: y + halfHeight(fontSize) }
    const corners = [[box.left, box.top], [box.right, box.top], [box.right, box.bottom], [box.left, box.bottom]]
    if (corners.some(([px, py]) => Math.hypot(px - center, py - center) > radius + 1e-8)) return false
    if (occupied.some(other => intersects(box, other))) return false
    occupied.push(box)
    result.push({ text, x, y, fontSize, rotation: 0, weight, primary })
    return true
  }

  const secondarySize = Math.max(10, Math.min(14, Math.floor(diameter * 0.065)))
  const primaryY = diameter < 48 ? diameter * 0.47 : diameter < 80 ? diameter * 0.44 : diameter * 0.34
  const primarySize = diameter < 80
    ? Math.max(10, Math.min(18, Math.floor(diameter * 0.22)))
    : Math.max(14, Math.min(32, Math.floor(diameter * 0.14)))
  const primaryMinimum = diameter < 80 ? 10 : Math.max(14, secondarySize + 2)
  const chars = Array.from(words[0])
  const titles = [words[0]]
  // Keep the complete title whenever it fits at a readable size.
  for (let length = chars.length - 1; length >= 1; length -= 1) titles.push(chars.slice(0, length).join('') + '…')
  if (diameter < 48 && chars.length > 1) titles.push(chars[0])
  for (const title of titles) {
    for (let size = primarySize; size >= primaryMinimum; size -= 1) {
      if (!place(title, center, primaryY, size, true)) continue
      break
    }
    if (result.length) break
  }
  if (!result.length || diameter < 80 || words.length === 1) return result

  const roomy = diameter >= 160
  const gap = Math.max(6, Math.min(10, diameter * 0.035))
  const rows = roomy ? [diameter * 0.53, diameter * 0.64] : [
    Math.min(diameter * 0.6, diameter * 0.8 - 9 - halfHeight(secondarySize) - 3),
  ]
  const secondaryLimit = roomy ? 6 : 2
  const firstRowLimit = roomy ? Math.min(3, Math.ceil(Math.min(words.length - 1, secondaryLimit) / 2)) : 2
  let pending = words.slice(1)
  let displayed = 0
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const y = rows[rowIndex]
    const availableWidth = rowWidth(y, secondarySize)
    const limit = rowIndex === 0 ? firstRowLimit : 3
    const row: { text: string; width: number }[] = []
    const deferred: string[] = []
    let cursor = 0
    let totalWidth = 0
    while (cursor < pending.length && row.length < limit && displayed + row.length < secondaryLimit) {
      const text = pending[cursor++]
      const paddedWidth = width(text, secondarySize, 500) + spacing * 2
      const nextWidth = totalWidth + (row.length ? gap : 0) + paddedWidth
      // Secondary words stay complete; overflow is available in the detail panel.
      if (nextWidth > availableWidth) {
        deferred.push(text)
        continue
      }
      row.push({ text, width: paddedWidth })
      totalWidth = nextWidth
    }
    pending = [...deferred, ...pending.slice(cursor)]
    let left = center - totalWidth / 2
    for (const word of row) {
      if (place(word.text, left + word.width / 2, y, secondarySize, false)) displayed += 1
      left += word.width + gap
    }
  }
  return result
}
