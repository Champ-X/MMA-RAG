import assert from 'node:assert/strict'
import { test } from 'node:test'
import { layoutPortraitWords, type PortraitWord } from '../src/components/knowledge/portraitWordCloud'

const measure = (text: string, fontSize: number) => Array.from(text).length * fontSize
const keywords = ['咖啡', '纪录片', '历史', '对比', '劳工', '传播', '文化', '生产', '种植']

function bounds(word: PortraitWord, diameter: number) {
  const spacing = diameter < 48 ? 0 : 2
  const halfWidth = measure(word.text, word.fontSize) / 2 + spacing
  const halfHeight = word.fontSize * 0.6 + spacing / 2
  const angle = word.rotation * Math.PI / 180
  const corners = [[-halfWidth, -halfHeight], [halfWidth, -halfHeight], [halfWidth, halfHeight], [-halfWidth, halfHeight]].map(([x, y]) => ({
    x: word.x + x * Math.cos(angle) - y * Math.sin(angle),
    y: word.y + x * Math.sin(angle) + y * Math.cos(angle),
  }))
  for (const corner of corners) assert.ok(Math.hypot(corner.x - diameter / 2, corner.y - diameter / 2) <= diameter / 2 - 6 + 1e-8)
  return { left: Math.min(...corners.map(p => p.x)), right: Math.max(...corners.map(p => p.x)), top: Math.min(...corners.map(p => p.y)), bottom: Math.max(...corners.map(p => p.y)) }
}

test('word clouds stay inside the circle and avoid words and the count label', () => {
  for (const diameter of [32, 39, 47, 48, 64, 80, 100, 128, 160, 180, 220, 280, 600]) {
    const words = layoutPortraitWords(keywords, diameter, 'real-topic-id', measure)
    const boxes = words.map(word => bounds(word, diameter))
    if (diameter >= 48) boxes.push({ left: diameter / 2 - Math.min(diameter * 0.55, 80) / 2, right: diameter / 2 + Math.min(diameter * 0.55, 80) / 2, top: diameter * 0.8 - 9, bottom: diameter * 0.8 + 9 })
    for (let i = 0; i < boxes.length; i += 1) for (let j = i + 1; j < boxes.length; j += 1) {
      const a = boxes[i], b = boxes[j]
      assert.ok(a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom, `overlap at ${diameter}px`)
    }
    assert.equal(words.filter(word => word.primary).length, 1, `primary missing at ${diameter}px`)
  }
})

test('roomy clouds use a horizontal title and two centered rows of complete keywords', () => {
  for (const diameter of [160, 180, 220, 280, 600]) {
    const words = layoutPortraitWords(keywords, diameter, 'coffee', measure)
    assert.equal(words.length, 7)
    assert.equal(new Set(words.map(word => word.text)).size, words.length)
    assert.ok(words.every(word => keywords.includes(word.text)))
    assert.ok(words.every(word => word.rotation === 0))
    assert.equal(words[0].text, '咖啡')
    assert.equal(words[0].x, diameter / 2)
    assert.equal(words[0].y, diameter * 0.34)
    assert.ok(words[0].fontSize > Math.max(...words.slice(1).map(word => word.fontSize)))
    assert.equal(new Set(words.slice(1).map(word => word.fontSize)).size, 1)
    const rows = new Map<number, PortraitWord[]>()
    for (const word of words.slice(1)) rows.set(word.y, [...(rows.get(word.y) ?? []), word])
    assert.deepEqual([...rows.keys()], [diameter * 0.53, diameter * 0.64])
    for (const row of rows.values()) {
      assert.equal(row.length, 3)
      const left = bounds(row[0], diameter).left
      const right = bounds(row[row.length - 1], diameter).right
      assert.ok(Math.abs((left + right) / 2 - diameter / 2) < 1e-8)
    }
  }
})

test('tiny bubbles show only their primary word and invalid sizes are empty', () => {
  for (const diameter of [0, -1, 31, Number.NaN, Number.POSITIVE_INFINITY]) assert.deepEqual(layoutPortraitWords(keywords, diameter, 'tiny'), [])
  for (const diameter of [32, 47, 64, 79]) {
    const words = layoutPortraitWords(keywords, diameter, 'tiny', measure)
    assert.equal(words.length, 1)
    assert.equal(words[0].primary, true)
  }
  assert.deepEqual(layoutPortraitWords([], 180, 'empty'), [])
})

test('small circles retain short titles and medium circles retain several real keywords', () => {
  const tiny = layoutPortraitWords(['字幕', '暗黑', '悬疑'], 39, 'subtitle', measure)
  assert.equal(tiny.length, 1)
  assert.equal(tiny[0].text, '字幕')
  assert.ok(tiny[0].fontSize >= 10)
  bounds(tiny[0], 39)
  const title = layoutPortraitWords(['藏宝阁'], 47, 'three-characters', measure)
  assert.equal(title[0].text, '藏宝阁')
  bounds(title[0], 47)
  for (const diameter of [100, 102, 110, 120]) {
    const medium = layoutPortraitWords(['藏宝阁', '降临', '三星', '神话', '仙岛'], diameter, '812ec76c-157f-49af-8355-0e07c73f8b94', measure)
    assert.equal(medium[0].text, '藏宝阁')
    assert.equal(medium.length, 3, `${diameter}px circle should show primary plus two complete secondary words`)
    assert.ok(medium.every(word => word.rotation === 0))
    assert.equal(new Set(medium.slice(1).map(word => word.y)).size, 1)
    assert.ok(medium.slice(1).every(word => ['降临', '三星', '神话', '仙岛'].includes(word.text)))
    medium.forEach(word => bounds(word, diameter))
  }
})

test('long terms shrink or truncate safely and custom font measurement is respected', () => {
  const original = '跨越不同大陆与时代的咖啡种植传播历史研究'
  const words = layoutPortraitWords([original, '历史研究', '历史研究', ' '], 100, 'long', measure)
  assert.equal(words[0].primary, true)
  assert.ok(words[0].text.endsWith('…'))
  assert.ok(original.startsWith(words[0].text.slice(0, -1)))
  words.forEach(word => bounds(word, 100))
  assert.equal(new Set(words.map(word => word.text)).size, words.length)
  const narrow = layoutPortraitWords(['MMMMMMMMMM'], 100, 'font', (text, size) => text.length * size * 0.3)
  const wide = layoutPortraitWords(['MMMMMMMMMM'], 100, 'font', (text, size) => text.length * size)
  assert.equal(narrow[0].text, 'MMMMMMMMMM')
  assert.notEqual(wide[0].text, narrow[0].text)
})

test('identical inputs are stable and whitespace/case duplicates are removed', () => {
  const input = [' 咖啡 ', '咖啡', 'Coffee', 'coffee', '历史', '劳工']
  const original = [...input]
  const first = layoutPortraitWords(input, 160, 'stable', measure)
  assert.deepEqual(layoutPortraitWords(input, 160, 'stable', measure), first)
  assert.deepEqual(layoutPortraitWords(input, 160, 'different-topic-id', measure), first)
  assert.deepEqual(input, original)
  assert.equal(new Set(first.map(word => word.text.toLocaleLowerCase())).size, first.length)
  assert.ok(first.length <= 4)
})

test('secondary overflow is omitted and later complete keywords can still fit', () => {
  const input = ['咖啡', '跨越不同大陆与时代的咖啡种植传播历史研究', '历史', '劳工', '传播']
  const words = layoutPortraitWords(input, 100, 'overflow', measure)
  assert.deepEqual(words.slice(1).map(word => word.text), ['历史', '劳工'])
  words.forEach(word => bounds(word, 100))
})

test('complete keywords that overflow the first row remain available for the next row', () => {
  const input = ['咖啡', '咖啡种植史', '历史与文化', '工业与传播', '咖啡与劳工', '非洲与美洲', '社会与经济']
  const words = layoutPortraitWords(input, 160, 'deferred', measure)
  const secondary = words.slice(1)
  assert.equal(secondary.length, 4)
  assert.deepEqual(secondary.map(word => word.text), input.slice(1, 5))
  assert.equal(secondary.filter(word => word.y === 160 * 0.53).length, 2)
  assert.equal(secondary.filter(word => word.y === 160 * 0.64).length, 2)
  words.forEach(word => bounds(word, 160))
})
