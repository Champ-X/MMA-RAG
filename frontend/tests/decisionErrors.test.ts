import assert from 'node:assert/strict'
import { test } from 'node:test'
import { decisionTestErrorMessage } from '../src/lib/decisionErrors'

test('Decision access and contract failures give distinct recovery actions', () => {
  assert.match(decisionTestErrorMessage('http_403'), /网络地区或访问权限受限/)
  assert.match(decisionTestErrorMessage('http_400'), /支持当前接口与输出格式/)
  assert.match(decisionTestErrorMessage('timeout'), /超时/)
  assert.match(decisionTestErrorMessage('budget_exhausted'), /调用预算已用尽/)
  assert.doesNotMatch(decisionTestErrorMessage('budget_exhausted'), /超时|稍后重试/)
  assert.match(decisionTestErrorMessage('model_mismatch'), /与所选模型不一致/)
  assert.match(decisionTestErrorMessage('invalid_probabilities'), /概率或置信度/)
  assert.match(decisionTestErrorMessage('http_503'), /服务商暂时不可用/)
})

test('unknown upstream errors are not echoed into the settings page', () => {
  const message = decisionTestErrorMessage('transport failed Authorization: Bearer secret-test-value')
  assert.doesNotMatch(message, /secret|Authorization|Bearer/)
  assert.equal(message, decisionTestErrorMessage())
  assert.match(message, /未通过验证/)
})
