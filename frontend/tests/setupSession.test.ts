import assert from 'node:assert/strict'
import { test } from 'node:test'
import { consumeSetupToken, getAuthToken, getSetupToken, setSetupToken } from '../src/lib/setupSession'

test('setup fragment is scrubbed before persistence and never saved in localStorage', () => {
  const calls: string[] = []
  const values = new Map<string, string>()
  Object.assign(globalThis, {
    window: { location: { hash: '#setup_token=synthetic-token', pathname: '/setup', search: '?welcome=1' }, history: { state: null, replaceState: (_: unknown, _title: string, url: string) => { calls.push(`scrub:${url}`) } } },
    sessionStorage: { getItem: (key: string) => values.get(key), setItem: (key: string, value: string) => { calls.push('persist'); values.set(key, value) }, removeItem: (key: string) => values.delete(key) },
    localStorage: { getItem: () => 'legacy-token', setItem: () => assert.fail('must not persist installation token in localStorage') },
  })
  consumeSetupToken()
  assert.deepEqual(calls, ['scrub:/setup?welcome=1', 'persist'])
  assert.equal(getSetupToken(), 'synthetic-token')
  assert.equal(getAuthToken(), 'synthetic-token')
  setSetupToken('')
  assert.equal(getAuthToken(), 'legacy-token')
})

test('blocked browser storage keeps the authenticated current tab usable', () => {
  Object.assign(globalThis, { sessionStorage: { setItem: () => { throw new Error('blocked') }, getItem: () => { throw new Error('blocked') }, removeItem: () => {} } })
  setSetupToken('private-session')
  assert.equal(getSetupToken(), 'private-session')
  setSetupToken('')
})
