import { getSetupToken } from '@/lib/setupSession'

export type Capability = 'text' | 'image' | 'audio' | 'video'
export type Provider = 'deepseek' | 'siliconflow' | 'aliyun_bailian' | 'openrouter'
export interface SetupCheck { provider: Provider; model: string; capability: string; task: string }
export interface SetupProgress {
  state: 'idle' | 'running' | 'interrupted' | 'error' | 'ready'
  models: Record<string, { state: string; message: string }>
  completed: number
  total: number
  elapsed_seconds?: number
}
export interface SetupStatus {
  managed: boolean
  setup_required: boolean
  configured: boolean
  tested: boolean
  prepared: boolean
  ready: boolean
  capabilities: Capability[]
  providers: Record<Provider, { configured: boolean }>
  task_models: Record<string, string>
  models?: Array<{ id: string; provider: Provider; type: string }>
  required_local_models: string[]
  checks: SetupCheck[]
  capability_checks?: Partial<Record<Capability, SetupCheck[]>>
  progress: SetupProgress
}
export interface SetupDraft {
  capabilities: Capability[]
  credentials: Partial<Record<Provider, string>>
  task_models?: Record<string, string>
  test_receipt?: string
}
export interface SetupTest {
  success: boolean
  results: Array<{ provider: string; model: string; capability: string; success: boolean; message: string }>
  test_receipt?: string
}
export class SetupError extends Error {
  constructor(message: string, readonly status: number) { super(message) }
}

// Deliberately separate from the general API client: no credential logging or login redirect.
async function request<T>(path: string, data?: unknown): Promise<T> {
  const token = getSetupToken()
  const base = String(import.meta.env?.VITE_API_BASE_URL || '/api').replace(/\/$/, '')
  const response = await fetch(`${base}/setup/${path}`, {
    method: data === undefined ? 'GET' : 'POST',
    headers: { ...(data === undefined ? {} : { 'Content-Type': 'application/json' }), ...(token ? { 'X-Tessmora-Setup-Token': token } : {}) },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    signal: AbortSignal.timeout(path === 'test' ? 600_000 : 20_000),
    cache: 'no-store',
    redirect: 'error',
  })
  const result = await response.json().catch(() => ({}))
  if (!response.ok) throw new SetupError(typeof result.detail === 'string' ? result.detail : `配置服务返回 ${response.status}，请检查连接后重试。`, response.status)
  return result
}

export const setupApi = {
  status: () => request<SetupStatus>('status'),
  config: () => request<SetupStatus>('config'),
  test: (draft: SetupDraft) => request<SetupTest>('test', draft),
  save: (draft: SetupDraft) => request<SetupStatus>('config', draft),
  prepare: () => request<SetupProgress>('prepare', {}),
}
