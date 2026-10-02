import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildPortraitSourceStats, formatPortraitPercentage } from '../src/components/knowledge/portraitSourceStats'

test('sample proportions use text chunks and media samples as the denominator', () => {
  const { total, segments } = buildPortraitSourceStats({ textCount: 70, imageCount: 10, audioCount: 5, videoShotCount: 15 })
  assert.equal(total, 100)
  assert.deepEqual(segments.map(source => source.percentage), [70, 10, 5, 15])
  assert.deepEqual(segments.map(source => source.offset), [0, 70, 80, 85])
  assert.deepEqual(segments.map(source => source.label), ['文本块', '图片', '音频', '视频片段'])
})

test('empty content never invents equal sectors and a single source fills the ring', () => {
  const empty = buildPortraitSourceStats({ textCount: 0, imageCount: 0, audioCount: 0, videoShotCount: 0 })
  assert.equal(empty.total, 0)
  assert.deepEqual(empty.segments.filter(source => source.count > 0), [])
  assert.ok(empty.segments.every(source => source.percentage === 0 && source.offset === 0))
  const videoOnly = buildPortraitSourceStats({ textCount: 0, imageCount: 0, audioCount: 0, videoShotCount: 397 })
  assert.equal(videoOnly.total, 397)
  assert.deepEqual(videoOnly.segments.filter(source => source.count > 0).map(source => source.percentage), [100])
})

test('invalid sample counts produce safe empty values and tiny shares stay visibly nonzero', () => {
  const { total, segments } = buildPortraitSourceStats({ textCount: Number.NaN, imageCount: -2, audioCount: Number.POSITIVE_INFINITY, videoShotCount: 0 })
  assert.equal(total, 0)
  assert.ok(segments.every(source => Number.isFinite(source.percentage)))
  assert.equal(formatPortraitPercentage(0), '0%')
  assert.equal(formatPortraitPercentage(0.04), '<0.1%')
  assert.equal(formatPortraitPercentage(33.333), '33.3%')
  assert.equal(formatPortraitPercentage(100), '100%')
})
