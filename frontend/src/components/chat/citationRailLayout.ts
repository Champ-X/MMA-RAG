export interface RailRect { left: number; right: number; top: number; bottom: number; width: number; height: number }

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))

/** Keep the complete source-to-card curve; the SVG viewport alone clips offscreen parts. */
export function citationRailLayout(workspace: RailRect, anchor: RailRect, composerTop: number, panelHeight: number, viewportWidth: number, answerRight?: number, viewportHeight = workspace.bottom) {
  const wide = workspace.width >= 980
  const clipLeft = clamp(workspace.left, 0, viewportWidth)
  const clipRight = clamp(workspace.right, clipLeft, viewportWidth)
  const availableWidth = clipRight - clipLeft
  const gutter = Math.min(workspace.width < 520 ? 12 : 24, availableWidth / 2)
  const preferredWidth = wide ? clamp(workspace.width * .28, 320, 400) : 380
  const width = Math.max(0, Math.min(preferredWidth, availableWidth - gutter * 2))
  const left = Math.max(clipLeft + gutter, Math.min(clipRight - gutter - width, wide && answerRight != null ? answerRight + 52 : Infinity))
  // The composer constrains the card, never the curve or its true source origin.
  const clipTop = clamp(workspace.top, 0, viewportHeight)
  const clipBottom = Math.max(clipTop, Math.min(workspace.bottom, viewportHeight))
  const panelTop = Math.max(12, workspace.top + 20)
  const panelBottom = Math.max(panelTop, Math.min(composerTop, workspace.bottom, viewportHeight) - 18)
  const maxHeight = Math.min(560, Math.max(0, panelBottom - panelTop))
  const height = Math.min(panelHeight || 460, maxHeight)
  const inline = anchor.width <= 72 && anchor.height <= 40
  // Scrolling a source behind the composer or beyond the screen must not detach its line.
  const fromX = anchor.right + 3
  const fromY = anchor.top + anchor.height * (inline ? .6 : .5)
  const top = Math.max(panelTop, Math.min(fromY - 96, panelBottom - height))
  const toY = top + Math.min(48, height / 2)
  const gap = left - fromX
  const visible = wide && height > 0 && gap > 0 && clipBottom > clipTop
    && anchor.right > clipLeft && anchor.left < clipRight

  // Longer control arms let the curve open gently across a paragraph or image row.
  const bend = Math.min(gap / 2, 220, Math.max(28, gap * .42))
  const arc = Math.abs(toY - fromY) < 24 ? -Math.min(32, Math.max(12, gap * .075)) : 0
  const control1X = fromX + bend
  const control2X = left - bend
  const control1Y = fromY + arc
  const control2Y = toY + arc

  return { wide, width, left, top, maxHeight,
    clip: { left: clipLeft, top: clipTop, width: availableWidth, height: clipBottom - clipTop },
    connector: visible ? {
      fromX, fromY, toX: left, toY, inline,
      path: `M ${fromX} ${fromY} C ${control1X} ${control1Y}, ${control2X} ${control2Y}, ${left} ${toY}`,
    } : null }
}
