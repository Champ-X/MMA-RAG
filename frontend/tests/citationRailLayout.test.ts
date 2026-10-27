import assert from 'node:assert/strict'
import { test } from 'node:test'
import { citationRailLayout, type RailRect } from '../src/components/chat/citationRailLayout'

const rect = (left: number, top: number, width: number, height: number): RailRect => ({ left, top, width, height, right: left + width, bottom: top + height })
const workspace = rect(240, 60, 1200, 900)

function curvePoints(layout: ReturnType<typeof citationRailLayout>) {
  assert.ok(layout.connector, 'the selected source should retain its direct connector')
  const points = layout.connector.path.match(/-?\d+(?:\.\d+)?/g)!.map(Number)
  assert.equal(points.length, 8, 'one continuous cubic connects the actual source directly to its card')
  assert.ok(points.every(Number.isFinite))
  return points
}

function sampleCurve(layout: ReturnType<typeof citationRailLayout>) {
  const [x0, y0, x1, y1, x2, y2, x3, y3] = curvePoints(layout)
  return Array.from({ length: 101 }, (_, i) => {
    const t = i / 100
    const q = 1 - t
    return {
      x: q ** 3 * x0 + 3 * q ** 2 * t * x1 + 3 * q * t ** 2 * x2 + t ** 3 * x3,
      y: q ** 3 * y0 + 3 * q ** 2 * t * y1 + 3 * q * t ** 2 * y2 + t ** 3 * y3,
    }
  })
}

function assertCurveInsideReadingViewport(layout: ReturnType<typeof citationRailLayout>) {
  const points = curvePoints(layout)
  // Wholly onscreen fixtures stay inside the viewport; offscreen fixtures below
  // deliberately preserve source/control coordinates outside this SVG clip.
  for (let i = 0; i < points.length; i += 2) {
    assert.ok(points[i] >= layout.clip.left && points[i] <= layout.clip.left + layout.clip.width)
    assert.ok(points[i + 1] >= layout.clip.top && points[i + 1] <= layout.clip.top + layout.clip.height)
  }
  for (const { x, y } of sampleCurve(layout)) {
    assert.ok(x >= layout.clip.left - 1e-6 && x <= layout.clip.left + layout.clip.width + 1e-6, 'curve x=' + x + ' leaves reading viewport')
    assert.ok(y >= layout.clip.top - 1e-6 && y <= layout.clip.top + layout.clip.height + 1e-6, 'curve y=' + y + ' leaves reading viewport')
  }
}

function assertCompleteCurveReachesViewport(layout: ReturnType<typeof citationRailLayout>, anchor: RailRect) {
  const points = curvePoints(layout)
  const sourceY = anchor.top + anchor.height * (layout.connector!.inline ? .6 : .5)
  assert.deepEqual(points.slice(0, 2), [anchor.right + 3, sourceY], 'screen clipping must never relocate the true source endpoint')
  assert.deepEqual(points.slice(-2), [layout.connector!.toX, layout.connector!.toY])
  assert.ok(sampleCurve(layout).slice(0, -1).some(point => point.x >= layout.clip.left
    && point.x <= layout.clip.left + layout.clip.width && point.y >= layout.clip.top
    && point.y <= layout.clip.top + layout.clip.height), 'the complete curve has a visible portion before it reaches the card')
}

test('the line starts at the actual citation and ends at its card instead of a detached answer-margin point', () => {
  const anchor = rect(650, 620, 24, 18)
  const layout = citationRailLayout(workspace, anchor, 780, 400, 1440, 1000)
  assert.equal(layout.connector?.fromX, anchor.right + 3)
  assert.ok(layout.connector!.fromY >= anchor.top + anchor.height / 2 && layout.connector!.fromY < anchor.bottom)
  assert.ok(layout.connector!.fromX < 1000, 'answer width must not move the source endpoint')
  assert.deepEqual(curvePoints(layout).slice(0, 2), [layout.connector!.fromX, layout.connector!.fromY])
  assert.equal(layout.connector!.toX, layout.left)
  assert.equal('lead' in layout.connector!, false)
  assert.ok(layout.left + layout.width <= workspace.right - 24)
  assert.ok(layout.top + 400 <= 780 - 18)
  assertCurveInsideReadingViewport(layout)
})

test('references at different paragraph ends remain connected without needing an empty interline lane', () => {
  for (const [left, top, width, height] of [[320, 110, 18, 18], [650, 280, 28, 22], [945, 510, 35, 24], [990, 700, 18, 18]]) {
    const anchor = rect(left, top, width, height)
    const layout = citationRailLayout(workspace, anchor, 780, 400, 1440, 1010)
    assert.equal(layout.connector?.fromX, anchor.right + 3)
    assert.ok(layout.connector!.fromY >= anchor.top && layout.connector!.fromY <= anchor.bottom)
    assertCurveInsideReadingViewport(layout)
  }
})

test('long-distance connectors use broad control arms and remain curved', () => {
  const layout = citationRailLayout(rect(240, 60, 2300, 1500), rect(400, 700, 24, 20), 1400, 460, 2560, 1800)
  const [x0, y0, x1, y1, x2, y2, x3, y3] = curvePoints(layout)
  assert.ok(x3 - x0 > 1000)
  assert.ok(x1 - x0 > 96 && x1 - x0 <= 220)
  assert.ok(x3 - x2 > 96 && x3 - x2 <= 220)
  assert.ok(Math.abs((x1 - x0) * (y3 - y0) - (y1 - y0) * (x3 - x0)) > 1)
  assert.ok(Math.abs((x2 - x0) * (y3 - y0) - (y2 - y0) * (x3 - x0)) > 1)
  assertCurveInsideReadingViewport(layout)
})

test('nearly level endpoints receive a gentle arch rather than a straight line', () => {
  const layout = citationRailLayout(workspace, rect(650, 116, 20, 20), 780, 400, 1440, 1000)
  const [, y0, , y1, , y2, , y3] = curvePoints(layout)
  assert.ok(Math.abs(y3 - y0) < 24)
  assert.ok(Math.abs(y1 - y0) >= 12 && Math.abs(y1 - y0) <= 32)
  assert.ok((y1 - y0) * (y2 - y3) > 0, 'both control points form one restrained arch')
  assertCurveInsideReadingViewport(layout)
})

test('a source image connects directly even when the curve overlaps a neighboring image', () => {
  const anchor = rect(500, 300, 250, 240)
  const neighbor = rect(770, 300, 210, 240)
  const layout = citationRailLayout(workspace, anchor, 780, 400, 1440, 1000)
  assert.equal(layout.connector?.inline, false)
  assert.equal(layout.connector?.fromX, anchor.right + 3)
  assert.equal(layout.connector?.fromY, 420)
  assert.ok(sampleCurve(layout).some(point => point.x > neighbor.left && point.x < neighbor.right
    && point.y > neighbor.top && point.y < neighbor.bottom), 'neighboring content does not force a detached or rerouted connection')
  assertCurveInsideReadingViewport(layout)
})

test('an image extending behind the composer keeps its original side midpoint', () => {
  const image = rect(600, 650, 250, 420)
  const layout = citationRailLayout(workspace, image, 780, 400, 1440, 1000)
  assert.equal(layout.connector?.fromX, image.right + 3)
  assert.equal(layout.connector?.fromY, (image.top + image.bottom) / 2)
  assert.ok(layout.connector!.fromY > 780)
  assert.equal(layout.clip.top + layout.clip.height, workspace.bottom)
  assertCurveInsideReadingViewport(layout)
})

test('images clipped above or at both vertical edges keep their original midpoint and a visible curve portion', () => {
  for (const image of [rect(600, -160, 250, 400), rect(500, -120, 250, 1100)]) {
    const layout = citationRailLayout(workspace, image, 780, 400, 1440, 1000)
    assert.equal(layout.connector?.fromX, image.right + 3)
    assert.equal(layout.connector!.fromY, image.top + image.height / 2)
    assertCompleteCurveReachesViewport(layout, image)
  }
})

test('fully offscreen images retain the full curve and unclamped source-side control point', () => {
  for (const image of [rect(600, 920, 250, 420), rect(600, -350, 250, 200)]) {
    const layout = citationRailLayout(workspace, image, 780, 400, 1440, 1000, 820)
    const points = curvePoints(layout)
    assert.equal(layout.connector?.fromY, image.top + image.height / 2)
    assert.equal(points[3], points[1], 'the first control point must not be clamped to the viewport')
    assertCompleteCurveReachesViewport(layout, image)
  }
})

test('references retain their true origin while scrolling behind the composer and below the screen', () => {
  for (const top of [744, 778, 790, 810, 940]) {
    const anchor = rect(650, top, 20, 20)
    const visible = citationRailLayout(workspace, anchor, 780, 400, 1440, 1000, 820)
    assert.equal(visible.connector?.fromX, anchor.right + 3)
    assert.equal(visible.connector?.fromY, top + 12)
    assert.ok(visible.connector!.fromY >= anchor.top && visible.connector!.fromY <= anchor.bottom)
    assertCompleteCurveReachesViewport(visible, anchor)
  }
})

test('the screenshot citation above the composer stays connected despite entering the former card safety margin', () => {
  const screenshotWorkspace = rect(256, 0, 1472, 820)
  const anchor = rect(900, 650.242, 20, 16)
  const composerTop = 676.5
  const layout = citationRailLayout(screenshotWorkspace, anchor, composerTop, 400, 1728, 1260)
  assert.ok(anchor.bottom < composerTop, 'the entire cited number is still above the input')
  assert.equal(layout.connector?.fromX, anchor.right + 3)
  assert.ok(Math.abs(layout.connector!.fromY - 659.842) < 1e-6)
  assert.equal(layout.clip.top, 0)
  assert.equal(layout.clip.top + layout.clip.height, 820)
  assert.ok(layout.top + 400 <= composerTop - 18, 'card spacing remains separate from connector visibility')
  assertCurveInsideReadingViewport(layout)
})

test('references partly or fully above the viewport keep a complete source-to-card path', () => {
  for (const anchor of [rect(650, 60, 20, 16), rect(650, 45, 20, 20), rect(650, 39, 20, 20), rect(650, -180, 20, 20)]) {
    const layout = citationRailLayout(workspace, anchor, 780, 400, 1440, 1000)
    assert.equal(layout.clip.top, 60)
    assert.equal(layout.connector?.fromY, anchor.top + anchor.height * .6)
    assertCompleteCurveReachesViewport(layout, anchor)
  }
})

test('a source below the input top preserves the line visible beside the input instead of clipping the entire horizontal band', () => {
  const screenshotWorkspace = rect(256, 0, 1472, 820)
  const anchor = rect(290, 710, 20, 16)
  const composerTop = 676.5
  const inputLeft = 600
  const layout = citationRailLayout(screenshotWorkspace, anchor, composerTop, 400, 1728, 1260, 820)
  assert.ok(layout.connector!.fromY > composerTop && layout.connector!.fromY < 820)
  assert.equal(layout.clip.top + layout.clip.height, 820)
  assert.ok(sampleCurve(layout).some(point => point.y > composerTop && point.x < inputLeft),
    'the exposed curve beside the composer must survive')
  assert.ok(layout.top + 400 <= composerTop - 18)
  assertCompleteCurveReachesViewport(layout, anchor)
})

test('a source entirely above the screenshot keeps its original endpoint and the visible remainder leading to the card', () => {
  const anchor = rect(900, -160, 20, 16)
  const layout = citationRailLayout(rect(256, 0, 1472, 820), anchor, 676.5, 400, 1728, 1260, 820)
  assert.ok(layout.connector!.fromY < 0)
  assert.equal(layout.connector!.fromY, anchor.top + anchor.height * .6)
  assert.ok(curvePoints(layout)[3] < 0, 'the source-side control point is preserved outside the clip too')
  assertCompleteCurveReachesViewport(layout, anchor)
})

test('a short positive gap still connects without requiring fourteen extra pixels of empty space', () => {
  const near = citationRailLayout(workspace, rect(1028, 300, 20, 20), 780, 400, 1440, 1000)
  assert.equal(near.connector!.toX - near.connector!.fromX, 1)
  assertCurveInsideReadingViewport(near)
  const overlapping = citationRailLayout(workspace, rect(1029, 300, 20, 20), 780, 400, 1440, 1000)
  assert.equal(overlapping.connector, null, 'the curve is omitted only once the source and card have no positive gap')
})

test('horizontally offscreen and card-overlapping source endpoints remain hidden', () => {
  for (const anchor of [rect(1270, 300, 20, 20), rect(100, 300, 20, 20)]) {
    assert.equal(citationRailLayout(workspace, anchor, 780, 360, 1440).connector, null)
  }
})

test('workspace and browser bounds constrain the SVG clip and card without constraining the true source', () => {
  const cropped = rect(240, 60, 1800, 900)
  const layout = citationRailLayout(cropped, rect(500, 300, 20, 20), 780, 400, 1200, 1000)
  assert.equal(layout.clip.left + layout.clip.width, 1200)
  assert.ok(layout.left + layout.width <= 1200)
  assertCurveInsideReadingViewport(layout)
  assert.equal(citationRailLayout(cropped, rect(1210, 300, 20, 20), 780, 400, 1200).connector, null)
  const offscreen = citationRailLayout(rect(1500, 60, 1000, 900), rect(1600, 300, 20, 20), 780, 400, 1200)
  assert.equal(offscreen.clip.width, 0)
  assert.equal(offscreen.width, 0)
  assert.equal(offscreen.connector, null)
  const tallWorkspace = rect(240, 60, 1200, 1100)
  const below = rect(650, 900, 20, 20)
  const viewportLimited = citationRailLayout(tallWorkspace, below, 700, 400, 1440, 1000, 820)
  assert.equal(viewportLimited.clip.top + viewportLimited.clip.height, 820)
  assert.equal(viewportLimited.connector?.fromY, 912)
  assertCompleteCurveReachesViewport(viewportLimited, below)
  const workspaceLimited = citationRailLayout(workspace, below, 700, 400, 1440, 1000, 1200)
  assert.equal(workspaceLimited.clip.top + workspaceLimited.clip.height, workspace.bottom)
})

test('narrow workspaces retain their source card without drawing a connector across the answer', () => {
  const desktopSidebar = citationRailLayout(rect(480, 64, 900, 700), rect(650, 300, 20, 20), 650, 340, 1920)
  assert.equal(desktopSidebar.wide, false)
  assert.equal(desktopSidebar.connector, null)
  assert.ok(desktopSidebar.left >= 480)
  const phone = citationRailLayout(rect(0, 0, 360, 720), rect(90, 170, 20, 20), 600, 400, 360)
  assert.equal(phone.connector, null)
  assert.ok(phone.left >= 12 && phone.left + phone.width <= 348)
})

test('short reading viewports keep card spacing without suppressing a still-visible source', () => {
  const layout = citationRailLayout(rect(0, 64, 1100, 360), rect(90, 100, 20, 20), 180, 460, 1100)
  assert.ok(layout.maxHeight > 0)
  assert.ok(layout.top + layout.maxHeight <= 180 - 18)
  assert.equal(layout.clip.top, 64)
  assert.equal(layout.clip.top + layout.clip.height, 424)
  assertCurveInsideReadingViewport(layout)
})

test('ultrawide card placement stays near the answer without moving the real source endpoint', () => {
  const answerRight = 1440
  const anchor = rect(1250, 600, 20, 20)
  const layout = citationRailLayout(rect(240, 60, 2300, 1500), anchor, 1400, 720, 2560, answerRight)
  assert.equal(layout.left - answerRight, 52)
  assert.equal(layout.connector?.fromX, anchor.right + 3)
  assert.ok(layout.maxHeight <= 560)
  assertCurveInsideReadingViewport(layout)
})
