import assert from 'node:assert/strict'
import { beforeEach, test } from 'node:test'
import type { SystemConfig } from '../src/store/useConfigStore'

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

// Import after installing storage to exercise the store's real persist middleware.
const { useConfigStore } = await import('../src/store/useConfigStore')
const defaults = structuredClone(useConfigStore.getState().config)
const flash = 'deepseek:deepseek-flash'
const kimi = 'Pro/moonshotai/Kimi-K2.6'
const oldDefaults: Record<string, { provider: string; model: string }> = {
  intent: { provider: 'aliyun_bailian', model: 'aliyun_bailian:qwen3.5-plus' },
  rewrite: { provider: 'siliconflow', model: 'Qwen/Qwen3.5-397B-A17B' },
  chat: { provider: 'siliconflow', model: kimi },
  portrait: { provider: 'siliconflow', model: kimi },
}
const legacyConfig = (): SystemConfig => ({
  ...structuredClone(defaults),
  theme: 'dark',
  defaultKnowledgeBaseIds: ['selected-kb'],
  models: defaults.models.map((model) => ({
    ...model, ...oldDefaults[model.id], temperature: 0.42,
  })),
})
const seed = (config: SystemConfig, version: number) => {
  storage.setItem('config-store', JSON.stringify({ state: { config }, version }))
}
const persisted = () => JSON.parse(storage.getItem('config-store')!)

beforeEach(() => {
  useConfigStore.setState({ config: structuredClone(defaults) })
  storage.clear()
})

test('a new browser starts with Flash for all four text tasks', () => {
  for (const id of Object.keys(oldDefaults)) {
    const model = useConfigStore.getState().getModelConfig(id)!
    assert.equal(model.model, flash)
    assert.equal(model.provider, 'deepseek')
  }
})

test('v0 rehydration migrates old task defaults and writes v1 without losing settings', async () => {
  const previous = legacyConfig()
  seed(previous, 0)
  await useConfigStore.persist.rehydrate()
  const current = useConfigStore.getState().config
  for (const id of Object.keys(oldDefaults)) {
    const model = current.models.find((entry) => entry.id === id)!
    assert.equal(model.model, flash)
    assert.equal(model.provider, 'deepseek')
    assert.equal(model.temperature, 0.42)
  }
  assert.equal(current.theme, 'dark')
  assert.deepEqual(current.defaultKnowledgeBaseIds, ['selected-kb'])
  assert.deepEqual(current.models.filter((model) => !(model.id in oldDefaults)),
    previous.models.filter((model) => !(model.id in oldDefaults)))
  assert.equal(persisted().version, 1)
  assert.deepEqual(persisted().state.config, current)
  assert.equal(previous.models.find((model) => model.id === 'chat')!.model, kimi)
})

test('v0 custom choices and models used in other tasks are preserved', async () => {
  const previous = legacyConfig()
  previous.models = previous.models.map((model) => model.id === 'chat'
    ? { ...model, provider: 'openrouter', model: 'openrouter:custom/chosen-model' }
    : model.id === 'caption' ? { ...model, provider: 'siliconflow', model: kimi } : model)
  seed(previous, 0)
  await useConfigStore.persist.rehydrate()
  for (const id of ['chat', 'caption']) {
    assert.deepEqual(useConfigStore.getState().getModelConfig(id),
      previous.models.find((model) => model.id === id))
  }
})

test('choosing an old model after migration survives later rehydration', async () => {
  seed(legacyConfig(), 0)
  await useConfigStore.persist.rehydrate()
  useConfigStore.getState().updateModelConfig('chat', { provider: 'siliconflow', model: kimi })
  const selected = persisted()
  assert.equal(selected.version, 1)
  // Simulate a fresh store state while restoring the actual saved selection.
  useConfigStore.setState({ config: structuredClone(defaults) })
  storage.setItem('config-store', JSON.stringify(selected))
  await useConfigStore.persist.rehydrate()
  assert.equal(useConfigStore.getState().getModelConfig('chat')!.model, kimi)
  assert.equal(persisted().state.config.models.find((model: { id: string }) => model.id === 'chat').model, kimi)
})
