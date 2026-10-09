import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { isAxiosError } from 'axios'
import { AlertCircle, ArrowRight, Check, CheckCircle2, ChevronDown, FlaskConical, KeyRound, ListFilter, Loader2, PlugZap, Quote, RotateCcw, Save, ScanLine, Zap, type LucideIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { BrandIcon, BrandSelect } from './BrandSelect'
import { cn } from '@/lib/utils'
import { decisionTestErrorMessage } from '@/lib/decisionErrors'
import { systemApi } from '@/services/api_client'
import type { DecisionConfig, DecisionProvider, DecisionSettingsResponse, DecisionTestResponse } from '@/types/decision'
import './decisionSettings.css'

const outlineButtonClass = 'decision-button decision-button-secondary'
function modelName(name: string) {
  return name.replace(/ · TypeSafe$/, '').replace(/^.*? · /, '')
}

function errorMessage(error: unknown) {
  if (isAxiosError(error) && typeof error.response?.data?.detail === 'string') return error.response.data.detail
  return '无法连接服务端，请检查后端连接后重试。'
}

function ModeOptions<T extends string>({ name, title, description, icon: Icon, tone, cards = false, value, options, onChange }: {
  name: string
  title: string
  description: string
  icon: LucideIcon
  tone: 'intent' | 'rerank' | 'citation'
  cards?: boolean
  value: T
  options: ReadonlyArray<{ value: T; label: string; description: string; disabled?: boolean }>
  onChange: (value: T) => void
}) {
  const id = useId()
  const selected = options.find((option) => option.value === value)
  return (
    <fieldset className={cn('decision-mode-group', `decision-tone-${tone}`, cards && 'is-cards')} aria-describedby={`${id}-help`}>
      <legend className="sr-only">{title}</legend>
      <div className="decision-mode-heading">
        <span className="decision-mode-icon"><Icon className="h-5 w-5" aria-hidden /></span>
        <div><h3 className="decision-mode-title">{title}</h3><p id={`${id}-help`} className="decision-mode-description">{description}</p></div>
      </div>
      <div className="decision-mode-selection">
        <div className="decision-mode-options">
          {options.map((option) => (
            <label key={option.value} className={cn('decision-mode-option', value === option.value && 'is-selected', option.value === 'off' && 'is-off', option.disabled && 'is-unavailable')}>
              <input type="radio" name={name} value={option.value} checked={value === option.value}
                disabled={option.disabled} onChange={() => onChange(option.value)}
                aria-labelledby={`${id}-${option.value}-label`} aria-describedby={`${id}-${option.value}-description`}
                className="decision-mode-radio" />
              <span className="decision-mode-option-content"><span className="decision-radio-mark" aria-hidden><Check className="decision-mode-check" /></span><span id={`${id}-${option.value}-label`}>{option.label}</span></span>
              <span id={`${id}-${option.value}-description`} className={cards ? "decision-option-description" : "sr-only"}>{option.description}</span>
            </label>
          ))}
        </div>
        {!cards && <p className="decision-current-description" role="status" aria-live="polite">{selected?.description}</p>}
      </div>
    </fieldset>
  )
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
  const dirty = !!draft && !!saved && (Object.keys(draft) as Array<keyof DecisionConfig>).some((key) => draft[key] !== saved.config[key])

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

  function change<K extends keyof DecisionConfig>(key: K, value: DecisionConfig[K]) {
    setDraft((current) => current ? { ...current, [key]: value } : current)
    if (key === 'model' || key === 'provider') clearTest()
    setMessage('')
    setError(null)
  }

  function selectProvider(provider: DecisionProvider) {
    if (!saved || !draft) return
    const model = provider === saved.config.provider ? saved.config.model : saved.models.find((item) => item.provider === provider)?.id ?? ''
    setDraft({ ...draft, provider, model })
    clearTest()
    setMessage('')
    setError(null)
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
      if (request === testId.current) {
        setTestError(isAxiosError(caught) && caught.code === 'ECONNABORTED'
          ? decisionTestErrorMessage('timeout') : errorMessage(caught))
      }
    } finally {
      if (request === testId.current) setTesting(false)
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!draft || saving || loading || !dirty) return
    const request = ++requestId.current
    setSaving(true)
    setError(null)
    setMessage('')
    try {
      const result = await systemApi.updateDecisionSettings({ ...draft })
      if (request !== requestId.current) return
      setSaved(result)
      setDraft(result.config)
      setMessage('Decision 设置已保存，对后续请求生效。')
    } catch (caught) {
      if (request === requestId.current) setError(errorMessage(caught))
    } finally {
      if (request === requestId.current) setSaving(false)
    }
  }

  const provider = saved?.providers.find((item) => item.id === draft?.provider)
  const unavailable = !provider?.api_key_configured
  const models = saved?.models.filter((item) => item.provider === draft?.provider) ?? []
  const enabled = saved && [saved.config.intent_mode, saved.config.rerank_mode, saved.config.citation_mode].some((mode) => mode !== 'off')
  const forced = draft?.intent_mode === 'force' || draft?.rerank_mode === 'force'
  const savedForced = saved?.config.intent_mode === 'force' || saved?.config.rerank_mode === 'force'
  const advancedEnabled = forced || draft?.rerank_mode !== 'off' || draft?.citation_mode !== 'off'
  const missingModel = !!draft && !models.some((item) => item.id === draft.model)
  const savedModel = saved?.models.find((item) => item.id === saved.config.model && item.provider === saved.config.provider)
  const advancedCount = draft ? Number(draft.rerank_mode !== 'off') + Number(draft.citation_mode !== 'off') + Number(draft.intent_mode === 'force') : 0

  return (
    <section id="decision" aria-labelledby={`${id}-title`} className="decision-settings">
      <header className="decision-header">
        <div className="decision-heading">
          <span className="decision-heading-icon"><Zap aria-hidden /></span>
          <div><h2 id={`${id}-title`}>Decision 模型</h2><p>为检索流程选择专门的判断模型</p></div>
        </div>
        <span className={cn('decision-status-badge', enabled && 'is-enabled', savedForced && 'is-forced')}><span aria-hidden className="decision-status-dot" />
          {loading ? '正在读取' : !saved ? '状态未知' : savedForced ? '严格模式已启用' : enabled ? '已启用' : '未启用'}
        </span>
      </header>
      <form onSubmit={submit} aria-busy={loading || saving}>
        {error && <div role="alert" className="decision-notice decision-error"><AlertCircle aria-hidden /><span>{error}</span></div>}
        {loading ? <p role="status" className="decision-loading"><Loader2 className="h-4 w-4 animate-spin" aria-hidden />正在读取 Decision 设置…</p> : draft && saved ? (
          <fieldset disabled={saving} className="decision-body">
            <legend className="sr-only">Decision 使用设置</legend>
            <div className="decision-model-workspace">
              <div className="decision-workspace-heading"><h3>模型连接</h3><span>{dirty ? '正在编辑 · 保存后生效' : '选择服务商与判断模型'}</span></div>
              <div className="decision-model-grid">
                <BrandSelect id={`${id}-provider`} name="decision-provider" label="服务商" ariaLabel="服务商" value={draft.provider}
                  options={saved.providers.map((item) => ({ value: item.id, label: item.name, provider: item.id, description: item.id === 'typesafe' ? '官方直连' : '多模型接入' }))}
                  onChange={(value) => selectProvider(value as DecisionProvider)} disabled={saving} className="decision-provider-select" />
                <span className="decision-route-arrow" aria-hidden><ArrowRight /></span>
                <BrandSelect id={`${id}-model`} name="decision-model" label="判断模型" ariaLabel="判断模型" value={draft.model}
                  options={[
                    ...(missingModel ? [{ value: draft.model, label: draft.model || '暂无可选模型', modelId: draft.model, provider: draft.provider, disabled: true }] : []),
                    ...models.map((item) => ({ value: item.id, label: modelName(item.name), description: item.id, modelId: item.id, provider: item.provider })),
                  ]} onChange={(value) => change('model', value)} disabled={saving} className="decision-model-select" />
              </div>
              <div className={cn('decision-connection', unavailable && 'is-unavailable')}>
                <div className="decision-connection-copy"><p className="decision-connection-line"><KeyRound aria-hidden /><span>{provider?.name ?? draft.provider} 密钥{unavailable ? '未配置' : '已配置'}</span></p>
                  {unavailable && <p className="decision-connection-help">在服务端配置 <code>{draft.provider === 'openrouter' ? 'OPENROUTER_API_KEY' : 'TYPESAFE_API_KEY'}</code> 并重启后端。</p>}
                </div>
                <Button type="button" variant="outline" size="sm" className="decision-button decision-test-button" disabled={unavailable || !draft.model || missingModel || testing} onClick={() => void testConnection()}>
                  {testing ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <PlugZap className="h-4 w-4" aria-hidden />}{testing ? '正在测试…' : '测试连接'}
                </Button>
              </div>
              {(testResult || testError) && <div role="status" aria-live="polite" className={cn('decision-test-result', testResult?.success ? 'is-success' : 'is-error')}>
                {testResult?.success ? <CheckCircle2 aria-hidden /> : <AlertCircle aria-hidden />}
                <div>{testResult?.success ? <><p>连接与输出格式验证通过 <span className="decision-test-duration">{testResult.duration_s.toFixed(2)} 秒</span></p><span>返回模型：{testResult.model}。测试未保存配置，不代表业务判断质量。</span></> : <><p>连接测试未通过</p><span>{testError || decisionTestErrorMessage(testResult?.error)}</span></>}</div>
              </div>}
              <div className="decision-active" aria-label="当前生效配置">
                <span className="decision-active-label"><CheckCircle2 aria-hidden />已保存</span>
                <BrandIcon provider={saved.config.provider} size={15} />
                <span className="decision-active-provider">{saved.providers.find((item) => item.id === saved.config.provider)?.name ?? saved.config.provider}</span>
                <span className="decision-active-divider" aria-hidden>/</span>
                <span className="decision-active-model">{savedModel ? modelName(savedModel.name) : saved.config.model}</span>
                <span className="decision-active-state">{enabled ? '用于后续请求' : '尚未启用'}</span>
              </div>
            </div>

            <ModeOptions name="decision-intent" title="意图识别" value={draft.intent_mode} icon={ScanLine} tone="intent" cards description="选择如何理解问题、决定检索路径。"
              options={[
                { value: 'off', label: '沿用原模型', description: '使用「模型与路由」中配置的意图模型。' },
                { value: 'adaptive', label: '自适应判断', description: '简单问题交给 Decision；复杂、多轮、不确定或调用失败时回退。', disabled: unavailable },
                ...(draft.intent_mode === 'force' ? [{ value: 'force' as const, label: '严格验证', description: '全部交给 Decision；失败时终止请求，不回退。' }] : []),
              ]} onChange={(value) => change('intent_mode', value)} />

            {forced && <div role="status" className="decision-notice decision-force-notice"><AlertCircle aria-hidden /><p><strong>严格模式：失败时不会回退。</strong> 所选环节超时或输出无效将终止请求，保存后对所有会话生效。</p></div>}
            <details className="decision-advanced">
              <summary>
                <span className="decision-advanced-symbol"><FlaskConical aria-hidden /></span>
                <span className="decision-advanced-title"><strong>高级设置与诊断</strong><span>检索重排、引用诊断与严格验证</span></span>
                {advancedEnabled && <span className="decision-advanced-count">已选择 {advancedCount} 项</span>}
                <ChevronDown className="decision-advanced-chevron" aria-hidden />
              </summary>
              <div className="decision-advanced-body">
                <div className="decision-diagnostics-grid">
                  <div className="decision-diagnostic-panel">
                    <ModeOptions name="decision-rerank" title="检索结果重排" value={draft.rerank_mode} icon={ListFilter} tone="rerank" description="对照或试用新的证据排序。"
                      options={[
                        { value: 'off', label: '沿用原策略', description: '保留现有排序，不增加 Decision 调用。' },
                        { value: 'shadow', label: '对照记录', description: '记录 Decision 排序差异，实际使用原结果。', disabled: unavailable },
                        { value: 'replace', label: '试用替换', description: '实验性采用 Decision 排序，失败时回退原策略。', disabled: unavailable },
                        { value: 'force', label: '严格验证', description: '仅采用 Decision 排序；失败时终止，不回退。', disabled: unavailable },
                      ]} onChange={(value) => change('rerank_mode', value)} />
                    {draft.rerank_mode === 'replace' && <div role="status" className="decision-notice decision-warning"><AlertCircle aria-hidden /><span>这会改变回答使用的证据。建议先用对照记录评估效果。</span></div>}
                  </div>
                  <div className="decision-diagnostic-panel">
                    <ModeOptions name="decision-citation" title="回答引用诊断" value={draft.citation_mode} icon={Quote} tone="citation" description="检查回答声明与引用是否一致。"
                      options={[
                        { value: 'off', label: '关闭', description: '直接返回答案，不增加引用诊断调用。' },
                        { value: 'shadow', label: '记录诊断', description: '记录来源支持情况，不改写或拦截答案；会增加等待时间。', disabled: unavailable },
                      ]} onChange={(value) => change('citation_mode', value)} />
                    {draft.citation_mode === 'shadow' && <fieldset className="decision-strategy">
                      <legend>诊断方式</legend>
                      <div className="decision-strategy-options">{[
                        { value: 'per_unit' as const, label: '逐条诊断' },
                        { value: 'batch_choice' as const, label: '批量诊断' },
                      ].map((option) => <label key={option.value}><input type="radio" name="decision-strategy" value={option.value} checked={draft.citation_strategy === option.value} onChange={() => change('citation_strategy', option.value)} />{option.label}</label>)}</div>
                      <p>{draft.citation_strategy === 'per_unit' ? '分别检查每条声明，产生多次调用。' : '合并检查多条声明；失败后不逐条重试。'}</p>
                    </fieldset>}
                  </div>
                </div>
                <label className="decision-strict-toggle"><input type="checkbox" name="decision-strict-intent" checked={draft.intent_mode === 'force'} disabled={unavailable && draft.intent_mode !== 'force'} onChange={(event) => change('intent_mode', event.target.checked ? 'force' : 'adaptive')} /><span><strong>严格验证意图识别 <span className="decision-experimental-label">仅供验证</span></strong><span>包括复杂与多轮问题，全部交给 Decision；关闭后恢复自适应判断。</span></span></label>
              </div>
            </details>
            <p className="decision-scope-note">查询改写和最终回答仍沿用「模型与路由」配置。</p>
          </fieldset>
        ) : null}
        <footer className={cn('decision-footer', dirty && 'has-changes')}>
          <div className="decision-save-status"><p role="status" aria-live="polite" className={cn(message && 'is-saved', dirty && 'is-dirty')}>
            {message ? <CheckCircle2 aria-hidden /> : <span className="decision-status-dot" aria-hidden />}
            {saving ? '正在保存…' : message || (dirty ? '有未保存的更改' : saved ? '所有更改已保存' : '请重新读取配置')}
          </p><span>保存后对后续请求生效</span></div>
          <div className="decision-footer-actions"><Button type="button" variant="outline" size="sm" className={outlineButtonClass} disabled={loading || saving} onClick={() => void load()}><RotateCcw aria-hidden />{dirty ? '放弃更改' : '重新读取'}</Button>
            {draft && <><Button type="button" variant="outline" size="sm" className={outlineButtonClass} disabled={loading || saving || [draft.intent_mode, draft.rerank_mode, draft.citation_mode].every((mode) => mode === 'off')}
              onClick={() => { setDraft({ ...draft, intent_mode: 'off', rerank_mode: 'off', citation_mode: 'off' }); setMessage(''); setError(null) }}>全部停用</Button>
              <Button type="submit" size="sm" className="decision-button decision-button-primary" disabled={loading || saving || !dirty}>{saving ? <Loader2 className="animate-spin" aria-hidden /> : <Save aria-hidden />}保存设置</Button></>}
          </div>
        </footer>
      </form>
    </section>
  )
}
