import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { isAxiosError } from 'axios'
import { AlertCircle, CheckCircle2, KeyRound, Loader2, PlugZap, Zap } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { BrandIcon, BrandSelect } from './BrandSelect'
import { cn } from '@/lib/utils'
import { decisionTestErrorMessage } from '@/lib/decisionErrors'
import { decisionPreferencesPayload, hasLegacyDecisionOptions, supportsSourceCheck } from '@/lib/decisionPreferences'
import { systemApi } from '@/services/api_client'
import type { DecisionConfig, DecisionProvider, DecisionSettingsResponse, DecisionTestResponse } from '@/types/decision'
import './decisionSettings.css'

const providerCredentials: Record<DecisionProvider, string> = {
  typesafe: 'TYPESAFE_API_KEY', openrouter: 'OPENROUTER_API_KEY', bailian: 'BAILIAN_DECISION_API_KEY',
}
function modelName(name: string) {
  return name.replace(/ · TypeSafe$/, '').replace(/^.*? · /, '')
}

function errorMessage(error: unknown) {
  if (isAxiosError(error) && typeof error.response?.data?.detail === 'string') return error.response.data.detail
  return '无法连接服务端，请检查后端连接后重试。'
}

function Preference({ name, title, description, checked, disabled, hint, onChange }: {
  name: string; title: string; description: string; checked: boolean; disabled: boolean
  hint?: string; onChange: (checked: boolean) => void
}) {
  const id = useId()
  return <label className={cn('decision-preference', disabled && 'is-unavailable')} htmlFor={id}>
    <span className="decision-preference-copy">
      <span id={`${id}-label`} className="decision-preference-title">{title}</span>
      <span id={`${id}-help`} className="decision-preference-help">{description}</span>
      {hint && <span id={`${id}-hint`} className="decision-preference-hint">{hint}</span>}
    </span>
    <input id={id} name={name} type="checkbox" role="switch" className="decision-switch"
      checked={checked} disabled={disabled} aria-labelledby={`${id}-label`}
      aria-describedby={`${id}-help${hint ? ` ${id}-hint` : ''}`} onChange={event => onChange(event.target.checked)} />
  </label>
}

export function DecisionSettings({ onHasChangesChange }: { onHasChangesChange: (dirty: boolean) => void }) {
  const id = useId()
  const [saved, setSaved] = useState<DecisionSettingsResponse | null>(null)
  const [draft, setDraft] = useState<DecisionConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<DecisionTestResponse | null>(null)
  const [testError, setTestError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const requestId = useRef(0)
  const testId = useRef(0)
  const dirty = !!draft && !!saved && (Object.keys(draft) as Array<keyof DecisionConfig>).some(key => draft[key] !== saved.config[key])

  useEffect(() => { onHasChangesChange(dirty) }, [dirty, onHasChangesChange])

  const clearTest = useCallback(() => {
    testId.current += 1
    setTesting(false)
    setTestResult(null)
    setTestError(null)
  }, [])

  const load = useCallback(async () => {
    const request = ++requestId.current
    clearTest()
    setLoading(true)
    setError(null)
    setMessage('')
    try {
      const result = await systemApi.getDecisionSettings()
      if (request !== requestId.current) return
      setSaved(result)
      setDraft(result.config)
    } catch (caught) {
      if (request === requestId.current) setError(errorMessage(caught))
    } finally {
      if (request === requestId.current) setLoading(false)
    }
  }, [clearTest])

  useEffect(() => {
    void load()
    return () => { requestId.current += 1; testId.current += 1 }
  }, [load])

  function edit(next: DecisionConfig) {
    if (!saved) return
    if (next.model !== draft?.model || next.provider !== draft?.provider) clearTest()
    setDraft(decisionPreferencesPayload(next, saved.models))
    setMessage('')
    setError(null)
  }

  function selectProvider(provider: DecisionProvider) {
    if (!saved || !draft) return
    const model = provider === saved.config.provider ? saved.config.model : saved.models.find(item => item.provider === provider)?.id ?? ''
    edit({ ...draft, provider, model })
  }

  async function testConnection() {
    if (!draft || testing) return
    const request = ++testId.current
    setTesting(true)
    setTestResult(null)
    setTestError(null)
    try {
      const result = await systemApi.testDecisionConnection({ provider: draft.provider, model: draft.model })
      if (request === testId.current) setTestResult(result)
    } catch (caught) {
      if (request === testId.current) setTestError(isAxiosError(caught) && caught.code === 'ECONNABORTED'
        ? decisionTestErrorMessage('timeout') : errorMessage(caught))
    } finally {
      if (request === testId.current) setTesting(false)
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!draft || !saved || saving || loading || (!dirty && !hasLegacyDecisionOptions(draft, saved.models))) return
    const payload = decisionPreferencesPayload(draft, saved.models)
    if ((payload.intent_mode !== 'off' || payload.citation_mode !== 'off')
      && !saved.providers.find(item => item.id === payload.provider)?.api_key_configured) {
      setError('请先配置所选服务商的密钥，或关闭下面的功能后保存。')
      return
    }
    const request = ++requestId.current
    setSaving(true)
    setError(null)
    setMessage('')
    try {
      const result = await systemApi.updateDecisionSettings(payload)
      if (request !== requestId.current) return
      setSaved(result)
      setDraft(result.config)
      setMessage('已保存，对新请求生效')
    } catch (caught) {
      if (request === requestId.current) setError(errorMessage(caught))
    } finally {
      if (request === requestId.current) setSaving(false)
    }
  }

  const provider = saved?.providers.find(item => item.id === draft?.provider)
  const unavailable = !provider?.api_key_configured
  const models = saved?.models.filter(item => item.provider === draft?.provider) ?? []
  const missingModel = !!draft && !models.some(item => item.id === draft.model)
  const sourceSupported = !!draft && !!saved && supportsSourceCheck(draft, saved.models)
  const sourceEnabled = sourceSupported && draft?.intent_mode !== 'off'
  const legacyActive = !!saved && hasLegacyDecisionOptions(saved.config, saved.models)
  const enabled = !!saved && [saved.config.intent_mode, saved.config.rerank_mode, saved.config.citation_mode].some(mode => mode !== 'off')
  const routeChanged = !!draft && !!saved && (draft.provider !== saved.config.provider || draft.model !== saved.config.model)
  const savedModel = saved?.models.find(item => item.id === saved.config.model && item.provider === saved.config.provider)
  const sourceAlternatives = saved?.models.filter(item => supportsSourceCheck({ provider: item.provider, model: item.id }, saved.models))
    .slice(0, 2).map(item => modelName(item.name)).join(' 或 ')

  return <section id="decision" aria-labelledby={`${id}-title`} className="decision-settings">
    <header className="decision-header">
      <div className="decision-heading"><Zap aria-hidden /><div><h2 id={`${id}-title`}>Decision 模型</h2><p>按需核对检索需求与回答引用</p></div></div>
      <span className={cn('decision-status-badge', enabled && 'is-enabled')}><span aria-hidden className="decision-status-dot" />
        {loading ? '正在读取' : !saved ? '状态未知' : legacyActive ? '使用旧版设置' : enabled ? '已启用' : '未启用'}
      </span>
    </header>
    <form onSubmit={submit} aria-busy={loading || saving}>
      {error && <p role="alert" className="decision-notice decision-error"><AlertCircle aria-hidden /><span>{error}</span></p>}
      {loading ? <p role="status" className="decision-loading"><Loader2 className="animate-spin" aria-hidden />正在读取设置…</p> : draft && saved ? (
        <fieldset disabled={saving} className="decision-body">
          <legend className="sr-only">Decision 使用设置</legend>
          <div className="decision-model-grid">
            <BrandSelect id={`${id}-provider`} name="decision-provider" label="服务商" value={draft.provider}
              options={saved.providers.map(item => ({ value: item.id, label: item.name, provider: item.id }))}
              onChange={value => selectProvider(value as DecisionProvider)} disabled={saving} />
            <BrandSelect id={`${id}-model`} name="decision-model" label="模型" value={draft.model}
              options={[
                ...(missingModel ? [{ value: draft.model, label: draft.model || '暂无可选模型', modelId: draft.model, provider: draft.provider, disabled: true }] : []),
                ...models.map(item => ({ value: item.id, label: modelName(item.name), description: item.id, modelId: item.id, provider: item.provider })),
              ]} onChange={model => edit({ ...draft, model })} disabled={saving} />
          </div>
          <div className="decision-connection">
            <div className="decision-connection-copy">
              <p className={cn('decision-connection-line', unavailable && 'is-unavailable')}><KeyRound aria-hidden />
                <span>{unavailable ? '未配置密钥' : '密钥已配置'}</span>
                {draft.provider === 'bailian' && <span className="decision-endpoint">{provider?.region === 'cn-beijing' ? '北京' : provider?.region === 'ap-southeast-1' ? '新加坡' : ''}{provider?.endpoint_kind === 'trial' ? '试用入口' : provider?.endpoint_kind === 'workspace' ? '业务空间入口' : 'Decision 接口'}</span>}
              </p>
              {unavailable && <p className="decision-connection-help">请在服务端配置 <code>{providerCredentials[draft.provider]}</code>。</p>}
            </div>
            <Button type="button" variant="outline" size="sm" className="decision-button decision-test-button"
              disabled={unavailable || !draft.model || missingModel || testing} onClick={() => void testConnection()}>
              {testing ? <Loader2 className="animate-spin" aria-hidden /> : <PlugZap aria-hidden />}{testing ? '测试中…' : '测试连接'}
            </Button>
          </div>
          {(testResult || testError) && <div role="status" aria-live="polite" className={cn('decision-test-result', testResult?.success ? 'is-success' : 'is-error')}>
            {testResult?.success ? <CheckCircle2 aria-hidden /> : <AlertCircle aria-hidden />}
            <span>{testResult?.success ? <>连接正常 <span className="decision-test-duration">{testResult.duration_s.toFixed(2)} 秒</span></>
              : testError || decisionTestErrorMessage(testResult?.error)}</span>
          </div>}
          {routeChanged && <p className="decision-saved-route"><span>当前使用</span><BrandIcon provider={saved.config.provider} size={14} />
            <span>{savedModel ? modelName(savedModel.name) : saved.config.model}</span><span>保存后切换</span></p>}
          {legacyActive && <p className="decision-legacy-note" role="note">旧版实验设置仍在生效。保存后将恢复常规排序，并按下方开关运行。</p>}

          <div className="decision-preferences">
            <Preference name="decision-source-check" title="核对检索需求"
              description="按你的要求核对素材类型，无法确定时继续原有检索。"
              checked={sourceEnabled} disabled={!sourceSupported || (unavailable && !sourceEnabled)}
              hint={!sourceSupported ? `此模型暂不支持${sourceAlternatives ? `，可选 ${sourceAlternatives}` : '，请选择支持此功能的模型'}。` : undefined}
              onChange={checked => edit({ ...draft, intent_mode: checked ? 'adaptive' : 'off' })} />
            <Preference name="decision-citation-check" title="检查回答引用"
              description="对照引用文字，标出依据不足或冲突的语句，供你复核。"
              checked={draft.citation_mode === 'shadow'} disabled={unavailable && draft.citation_mode === 'off'}
              onChange={checked => edit({ ...draft, citation_mode: checked ? 'shadow' : 'off' })} />
          </div>
          <p className="decision-scope-note">开启会增加模型调用。适用于普通检索与 Agent 深研，Pi Agent 使用独立流程。</p>
        </fieldset>
      ) : null}
      <footer className="decision-footer">
        <p role="status" aria-live="polite" className={cn('decision-save-status', message && 'is-saved', dirty && 'is-dirty')}>
          {message && <CheckCircle2 aria-hidden />}{saving ? '正在保存…' : message || (dirty ? '更改尚未保存' : legacyActive ? '保存后应用简化设置' : saved ? '已保存' : '设置未载入')}
        </p>
        <div className="decision-footer-actions">
          {(dirty || !saved) && <Button type="button" variant="outline" size="sm" className="decision-button decision-button-secondary" disabled={loading || saving} onClick={() => void load()}>{saved ? '取消' : '重新读取'}</Button>}
          {draft && <Button type="submit" size="sm" className="decision-button decision-button-primary" disabled={loading || saving || (!dirty && !legacyActive)}>
            {saving && <Loader2 className="animate-spin" aria-hidden />}{legacyActive && !dirty ? '应用简化设置' : '保存设置'}
          </Button>}
        </div>
      </footer>
    </form>
  </section>
}
