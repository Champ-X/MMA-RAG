import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { i18next, setLanguage } from '../src/i18n'
import { piEnglish } from '../src/i18n/pi.en'
import { applyPiEvent, initialPiTrace, piStepText, submissionFeedback } from '../src/lib/piTrace'
import type { PiRun, PiStep } from '../src/types/pi'

i18next.addResourceBundle('en-US', 'translation', piEnglish, true, true)
i18next.addResourceBundle('zh-CN', 'translation', Object.fromEntries(Object.keys(piEnglish).map(key => [key, key])), true, true)
afterEach(() => setLanguage('zh-CN'))
const run: PiRun = { id: 'run', status: 'running', seq: 0, session_id: 'session', created_at: 1, config: { model: 'fixture' },
  request: { client_request_id: 'request', message: '中文问题' }, state: {} }

test('saved requirement traces switch presentation language while preserving quotes, points, and stored records', () => {
  const trace = applyPiEvent(initialPiTrace(run), { protocol_version: 1, run_id: 'run', event_id: 'event', seq: 1,
    timestamp: 1, type: 'answer.requirements', data: { max_characters: 100, length_quote: '请在100字内说明', required_points: ['完成', '原始要求 English'] } })
  const snapshot = structuredClone(trace)
  const zh = piStepText(trace.steps[0])!
  assert.match(zh, /正文上限 100 字符/)
  setLanguage('en-US')
  const en = piStepText(trace.steps[0])!
  assert.match(en, /Body limit: 100 characters/)
  assert.match(en, /Required points: 完成；原始要求 English/)
  assert.match(en, /User quote: 请在100字内说明/)
  assert.deepEqual(trace, snapshot)
  setLanguage('zh-CN')
  assert.equal(piStepText(trace.steps[0]), zh)
})

test('plan presentation translates only statuses and chrome, retaining model-authored requirements and gaps', () => {
  const trace = applyPiEvent(initialPiTrace(run), { protocol_version: 1, run_id: 'run', event_id: 'event', seq: 1,
    timestamp: 1, type: 'answer.plan', data: { items: [{ id: 'result', requirement: '准备检索资料', status: 'incomplete', gap: '原始缺口', basis: 'sources' }] } })
  setLanguage('en-US')
  assert.match(piStepText(trace.steps[0])!, /^Incomplete · 准备检索资料：原始缺口/)
  const action: PiStep = { id: 'action', kind: 'action', status: 'completed', label: '行动说明', startedAt: 1, text: '准备检索资料' }
  assert.equal(piStepText(action), '准备检索资料')
})

test('historical context wrappers remain translatable without changing original quote text', () => {
  const step: PiStep = { id: 'old', kind: 'context', status: 'completed', label: '已登记回答要求', startedAt: 1,
    text: '正文上限 100 字符。\n回答要点：保留原问题\n用户原句：完成\n取消\n以上为 Pi 对用户要求的理解。' }
  setLanguage('en-US')
  assert.match(piStepText(step)!, /User quote: 完成\n取消/)
  assert.match(piStepText(step)!, /Body limit: 100 characters/)
})

test('both feedback languages and stable error codes produce translated summaries with verbatim detail', () => {
  const report = JSON.stringify({ body_characters: 120, declared_max_characters: 100,
    errors: [{ code: 'answer_too_long' }], units: [{ text: '不要翻译这份草稿' }] })
  setLanguage('en-US')
  for (const prefix of ['逐项检查未通过：', 'Unit checks failed. ', '']) {
    const text = prefix + report
    const feedback = submissionFeedback({ kind: 'tool', label: 'submit_answer', status: 'failed', errorCode: 'answer_too_long', text })!
    assert.match(feedback.summary, /120 characters.*100-character limit/)
    assert.equal(feedback.detail, text)
  }
})
