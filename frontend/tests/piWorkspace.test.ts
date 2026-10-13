import assert from 'node:assert/strict'
import { test } from 'node:test'
import { piApi, PiApiError } from '../src/services/piAgent'
import { getSetupToken, setSetupToken } from '../src/lib/setupSession'

test('workspace reconnect validates a private link before persisting its credential', async t => {
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch; setSetupToken('') })
  setSetupToken('existing-token')
  const calls: Array<{ url: string; auth: string | null }> = []
  globalThis.fetch = async (input, init) => {
    const auth = new Headers(init?.headers).get('Authorization')
    calls.push({ url: String(input), auth })
    assert.ok(init?.signal)
    assert.equal(init?.cache, 'no-store')
    return auth === 'Bearer valid-token' ? Response.json({ default_model: 'test-model', models: ['test-model'] })
      : Response.json({ detail: 'unauthorized' }, { status: 401 })
  }
  await assert.rejects(piApi.connect('invalid-token'), error => error instanceof PiApiError && error.status === 401)
  assert.equal(getSetupToken(), 'existing-token')
  const config = await piApi.connect('http://localhost:3001/#setup_token=valid-token')
  assert.equal(config.default_model, 'test-model')
  assert.equal(getSetupToken(), 'valid-token')
  assert.deepEqual(calls.map(row => row.url), ['/api/pi/config', '/api/pi/config'], 'never fetch or send the credential in a pasted URL')
  await assert.rejects(piApi.connect('http://localhost:3001/'), /完整/)
  assert.equal(calls.length, 2)
})

test('workspace timeout gives an actionable error and does not replace credentials', async t => {
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch; setSetupToken('') })
  setSetupToken('prior-token')
  globalThis.fetch = async () => { throw new DOMException('timed out', 'TimeoutError') }
  await assert.rejects(piApi.connect('new-token'), /连接工作区超时/)
  assert.equal(getSetupToken(), 'prior-token')
})
