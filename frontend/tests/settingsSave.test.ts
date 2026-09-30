import assert from 'node:assert/strict'
import { afterEach, beforeEach, mock, test } from 'node:test'
import type { ModelConfig, SystemConfig } from '../src/store/useConfigStore'

const values = new Map<string, string>()
const storage: Storage = {
  get length() { return values.size },
  clear: () => values.clear(),
  getItem: (key) => values.get(key) ?? null,
  key: (index) => [...values.keys()][index] ?? null,
  removeItem: (key) => { values.delete(key) },
  setItem: (key, value) => { values.set(key, value) },
}
Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true })

// Use the real store and persistence middleware, with only the network call mocked.
const { useConfigStore } = await import('../src/store/useConfigStore')
const { systemApi } = await import('../src/services/api_client')
const defaults = structuredClone(useConfigStore.getState().config)
const persistedConfig = (): SystemConfig => JSON.parse(storage.getItem('config-store')!).state.config
const draftModels = (): ModelConfig[] => defaults.models.map((model) => model.id === 'chat'
  ? { ...model, provider: 'openrouter', model: 'openrouter:custom/draft-model' }
  : { ...model })
const deferred = <T>() => {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}

beforeEach(() => {
  storage.clear()
  useConfigStore.setState({
    config: structuredClone(defaults),
    isLoading: false,
    error: null,
    hasUnsavedChanges: false,
  })
})

afterEach(() => { mock.restoreAll() })

test('saving a draft sends its routes without exposing or persisting them while the API is pending', async () => {
  const response = deferred<unknown>()
  const update = mock.method(systemApi, 'updateModelConfig', () => response.promise)
  const draft = draftModels()
  const previousConfig = useConfigStore.getState().config
  const previousPersisted = storage.getItem('config-store')
  const pending = useConfigStore.getState().saveConfig(draft)

  assert.equal(update.mock.callCount(), 1)
  assert.deepEqual(update.mock.calls[0].arguments[0].tasks.final_generation, {
    model: 'openrouter:custom/draft-model', provider: 'openrouter',
  })
  assert.equal(useConfigStore.getState().isLoading, true)
  assert.equal(useConfigStore.getState().config, previousConfig)
  assert.equal(storage.getItem('config-store'), previousPersisted)

  response.resolve({ saved: true })
  await pending
})

test('a rejected draft keeps the last saved models in memory and storage so undo can recover them', async () => {
  const response = deferred<unknown>()
  mock.method(systemApi, 'updateModelConfig', () => response.promise)
  const previousConfig = useConfigStore.getState().config
  const previousPersisted = storage.getItem('config-store')
  const failure = new Error('backend rejected route')
  const pending = useConfigStore.getState().saveConfig(draftModels())
  const rejected = assert.rejects(pending, failure)
  response.reject(failure)
  await rejected

  assert.equal(useConfigStore.getState().config, previousConfig)
  assert.deepEqual(useConfigStore.getState().config.models, defaults.models)
  assert.equal(storage.getItem('config-store'), previousPersisted)
  assert.equal(useConfigStore.getState().isLoading, false)
  assert.equal(useConfigStore.getState().hasUnsavedChanges, true)
  assert.equal(useConfigStore.getState().error, failure.message)
})

test('an accepted draft persists the submitted snapshot and preserves interface changes made during the request', async () => {
  const response = deferred<unknown>()
  mock.method(systemApi, 'updateModelConfig', () => response.promise)
  const draft = draftModels()
  const submitted = structuredClone(draft)
  const pending = useConfigStore.getState().saveConfig(draft)

  useConfigStore.getState().updateSystemConfig({ theme: 'dark', enableCitations: false })
  draft.find((model) => model.id === 'chat')!.model = 'mutated-after-submit'
  response.resolve({ saved: true })
  await pending

  const current = useConfigStore.getState()
  assert.deepEqual(current.config.models, submitted)
  assert.equal(current.config.theme, 'dark')
  assert.equal(current.config.enableCitations, false)
  assert.deepEqual(persistedConfig(), current.config)
  assert.equal(current.isLoading, false)
  assert.equal(current.hasUnsavedChanges, false)
  assert.equal(current.error, null)
})

test('existing saveConfig calls without a draft still save the current routes', async () => {
  const update = mock.method(systemApi, 'updateModelConfig', async () => ({ saved: true }))
  useConfigStore.getState().updateModelConfig('chat', {
    provider: 'siliconflow', model: 'Pro/moonshotai/Kimi-K2.6',
  })
  const currentConfig = useConfigStore.getState().config
  await useConfigStore.getState().saveConfig()

  assert.deepEqual(update.mock.calls[0].arguments[0].tasks.final_generation, {
    model: 'Pro/moonshotai/Kimi-K2.6', provider: 'siliconflow',
  })
  assert.equal(useConfigStore.getState().config, currentConfig)
  assert.deepEqual(persistedConfig(), currentConfig)
  assert.equal(useConfigStore.getState().hasUnsavedChanges, false)
})
