import assert from 'node:assert/strict'
import { test } from 'node:test'
import { citationScoreDetails, citationScoreSummary } from '../src/lib/citationScores'

test('legacy screenshot zeros are unavailable and old rerank is labelled as the composite score', () => {
  const reference = { scores: { dense: 0, sparse: 0, visual: 0, rerank: 0.856 } }
  assert.deepEqual(citationScoreSummary(reference), { label: '综合排序分', value: '0.856' })
  const details = citationScoreDetails(reference)
  assert.equal(details.entries.filter(entry => entry.value === '历史未记录').length, 4)
  assert.ok(details.entries.every(entry => entry.value !== '0.000'))
  assert.match(details.note, /无法还原/)
})

test('real zero remains zero while unavailable channels are not fabricated', () => {
  const reference = { score_version: 2, scores: { dense: 0, sparse: 12.36, visual: null, rerank: 0, final: 0.21 } }
  assert.deepEqual(citationScoreSummary(reference), { label: '重排得分', value: '0.000' })
  assert.deepEqual(citationScoreDetails(reference).entries.map(entry => entry.value),
    ['0.210', '0.000', '0.000', '12.360', '未提供'])
})

test('missing or invalid scores never fall back to a numeric zero', () => {
  for (const scores of [undefined, {}, { rerank: NaN, dense: Infinity, final: null }]) {
    const reference = { score_version: 2, scores }
    assert.deepEqual(citationScoreSummary(reference), { label: '检索得分', value: '未提供' })
    assert.ok(citationScoreDetails(reference).entries.every(entry => entry.value === '未提供'))
  }
})

test('fallback score labels identify their actual stage without comparing different scales', () => {
  assert.deepEqual(citationScoreSummary({ score_version: 2, scores: { final: 0.12, sparse: 18 } }),
    { label: '综合排序分', value: '0.120' })
  assert.deepEqual(citationScoreSummary({ score_version: 2, scores: { visual: -0.025 } }),
    { label: '视觉检索得分', value: '-0.025' })
})
