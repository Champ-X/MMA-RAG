import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { isAxiosError } from 'axios'
import { AlertCircle, Check, ChevronDown, FlaskConical, Info, KeyRound, Layers, ListFilter, Loader2, Quote, RotateCcw, Save, ScanLine, Zap, type LucideIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { systemApi } from '@/services/api_client'
import type { JevConfig, JevSettingsResponse } from '@/types/jev'
import './jevSettings.css'

const OFF_CONFIG: JevConfig = {
  intent_mode: 'off', rerank_mode: 'off', citation_mode: 'off', citation_strategy: 'per_unit',
}
const outlineButtonClass = 'jev-button jev-button-secondary'

function errorMessage(error: unknown) {
  if (isAxiosError(error) && typeof error.response?.data?.detail === 'string') {
    return error.response.data.detail
  }
  return '无法同步 Jev 设置，请检查后端连接后重试。'
}

function ModeOptions<T extends string>({ name, title, description, icon: Icon, tone, nested, value, options, onChange }: {
  name: string
  title: string
  description: string
  icon: LucideIcon
  tone: 'intent' | 'rerank' | 'citation'
  nested?: boolean
  value: T
  options: ReadonlyArray<{ value: T; label: string; description: string; disabled?: boolean }>
  onChange: (value: T) => void
}) {
  const id = useId()
  const selected = options.find((option) => option.value === value)
  return (
    <fieldset className={cn('jev-mode-group', `jev-tone-${tone}`, nested && 'is-nested')} aria-describedby={`${id}-help`}>
      <legend className="sr-only">{title}</legend>
      <div className="jev-mode-heading">
        <span className="jev-mode-icon"><Icon className="h-5 w-5" aria-hidden /></span>
        <div><h3 className="jev-mode-title">{title}</h3><p id={`${id}-help`} className="jev-mode-description">{description}</p></div>
      </div>
      <div className="jev-mode-selection">
        <div className="jev-mode-options">
          {options.map((option) => (
            <label key={option.value} title={`${option.label}：${option.description}`} className={cn(
              'jev-mode-option',
              value === option.value && 'is-selected',
              option.value === 'off' && 'is-off',
              option.disabled && 'is-unavailable'
            )}>
              <input type="radio" name={name} value={option.value} checked={value === option.value}
                disabled={option.disabled} onChange={() => onChange(option.value)}
                aria-labelledby={`${id}-${option.value}-label`} aria-describedby={`${id}-${option.value}-description`}
                className="jev-mode-radio" />
              <span className="jev-mode-option-content"><Check className="jev-mode-check h-3 w-3" aria-hidden /><span id={`${id}-${option.value}-label`}>{option.label}</span></span>
              <span id={`${id}-${option.value}-description`} className="sr-only">{option.description}</span>
            </label>
          ))}
        </div>
        <p className="jev-current-description" role="status" aria-live="polite">{selected?.description}</p>
      </div>
    </fieldset>
  )
}

export function JevSettings({ onHasChangesChange }: { onHasChangesChange: (dirty: boolean) => void }) {
  const keyHelpId = useId()
  const [saved, setSaved] = useState<JevSettingsResponse | null>(null)
  const [draft, setDraft] = useState<JevConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const requestId = useRef(0)
  const dirty = !!draft && !!saved && (Object.keys(draft) as Array<keyof JevConfig>)
    .some((key) => draft[key] !== saved.config[key])

  useEffect(() => { onHasChangesChange(dirty) }, [dirty, onHasChangesChange])

  const load = useCallback(async () => {
    const id = ++requestId.current
    setLoading(true)
    setError(null)
    setMessage('')
    try {
      const result = await systemApi.getJevSettings()
      if (id !== requestId.current) return
      setSaved(result)
      setDraft(result.config)
    } catch (caught) {
      if (id === requestId.current) setError(errorMessage(caught))
    } finally {
      if (id === requestId.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
    return () => { requestId.current += 1 }
  }, [load])

  function change<K extends keyof JevConfig>(key: K, value: JevConfig[K]) {
    setDraft((current) => current ? { ...current, [key]: value } : current)
    setMessage('')
    setError(null)
  }

  async function save(config: JevConfig) {
    setSaving(true)
    setError(null)
    setMessage('')
    try {
      const result = await systemApi.updateJevSettings(config)
      setSaved(result)
      setDraft(result.config)
      setMessage('Jev 设置已保存，对后续请求生效。')
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setSaving(false)
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (draft && !saving && !loading) void save(draft)
  }

  const unavailable = !saved?.api_key_configured
  const enabled = saved && [saved.config.intent_mode, saved.config.rerank_mode, saved.config.citation_mode]
    .some((mode) => mode !== 'off')
  const forced = draft?.intent_mode === 'force' || draft?.rerank_mode === 'force'
  const savedForced = saved?.config.intent_mode === 'force' || saved?.config.rerank_mode === 'force'

  return (
    <section id="jev" aria-labelledby="jev-title" className="jev-settings">
      <header className="jev-header">
        <div className="jev-heading">
          <Zap className="h-[18px] w-[18px]" aria-hidden /><h2 id="jev-title">Jev 语义判断</h2>
        </div>
        <span className={cn('jev-status-badge', enabled && 'is-enabled', savedForced && 'is-forced')}>
          <span aria-hidden className="jev-status-dot" />
          {loading ? '正在读取' : !saved ? '状态未知' : savedForced ? '当前含强制模式' : enabled ? '当前已启用' : '当前未启用'}
        </span>
      </header>
      <form onSubmit={submit} aria-busy={loading || saving}>
        {error && <div role="alert" className="jev-notice jev-error">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /><span>{error}</span>
        </div>}
        {loading ? <p role="status" className="jev-loading"><Loader2 className="h-4 w-4 animate-spin" aria-hidden />正在读取服务端 Jev 设置…</p> : draft && saved ? (
          <fieldset disabled={saving} className="jev-body">
            <legend className="sr-only">Jev 使用设置</legend>
            <div className={cn('jev-connection', unavailable && 'is-unavailable')}>
              <div className="jev-connection-line"><KeyRound className="h-3.5 w-3.5" aria-hidden /><span className="jev-connection-title">{unavailable ? 'API 密钥未配置' : 'API 密钥已配置'}</span><span className="jev-connection-divider">·</span><code>{saved.model}</code>
                {!unavailable && <span className="jev-key-note" tabIndex={0} title="密钥状态不代表服务可用性。" aria-label="关于密钥状态" aria-describedby={keyHelpId}><Info className="h-3.5 w-3.5" aria-hidden /><span className="sr-only" id={keyHelpId}>密钥状态不代表服务可用性。</span></span>}
              </div>
              {unavailable && <p className="jev-connection-help">请在服务端设置 <code>TYPESAFE_API_KEY</code> 并重启后端，再开启 Jev。</p>}
              <p className="jev-scope-note">查询改写和最终回答沿用原模型。</p>
            </div>
            <ModeOptions name="jev-intent" title="意图识别" value={draft.intent_mode}
              icon={ScanLine} tone="intent" description="理解问题，选择检索路径。"
              options={[
                { value: 'off', label: '关闭', description: '沿用原模型的意图判断。' },
                { value: 'adaptive', label: '简单快路径', description: '简单问题优先使用 Jev，其他请求回退原模型。', disabled: unavailable },
                { value: 'force', label: '强制 Jev', description: '包括复杂、多轮问题，始终采用 Jev，不回退。', disabled: unavailable },
              ]}
              onChange={(value) => change('intent_mode', value)} />
            <ModeOptions name="jev-rerank" title="检索结果重排" value={draft.rerank_mode}
              icon={ListFilter} tone="rerank" description="让更相关的内容排在前面。"
              options={[
                { value: 'off', label: '关闭', description: '保留原重排结果。' },
                { value: 'shadow', label: '对照评估', description: '运行 Jev 作对照，答案仍采用原重排结果。', disabled: unavailable },
                { value: 'replace', label: '替换重排', description: '实验模式：采用 Jev 重排，失败时回退原策略。', disabled: unavailable },
                { value: 'force', label: '强制 Jev', description: '仅采用 Jev 重排，不回退。', disabled: unavailable },
              ]}
              onChange={(value) => change('rerank_mode', value)} />
            {draft.rerank_mode === 'replace' && <p role="status" className="jev-notice jev-warning"><AlertCircle className="h-4 w-4 shrink-0" aria-hidden />已有评测中 Jev 重排质量低于 Qwen，建议优先使用对照评估。</p>}
            {forced && <div role="status" className="jev-notice jev-force-notice"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /><p><strong>强制模式不会回退。</strong> 若 Jev 超时、调用失败或返回无效结果，当前请求会明确报错并终止。仅作用于选中的意图识别、重排环节；查询改写和最终回答仍使用原模型。</p></div>}
            <ModeOptions name="jev-citation" title="回答引用诊断" value={draft.citation_mode}
              icon={Quote} tone="citation" description="检查回答与引用来源是否一致。"
              options={[
                { value: 'off', label: '关闭', description: '直接返回答案，不额外运行引用诊断。' },
                { value: 'shadow', label: '开启诊断', description: '检查声明是否被所引来源支持。仅提供诊断，不改写或拦截答案；会增加回答完成等待。', disabled: unavailable },
              ]}
              onChange={(value) => change('citation_mode', value)} />
            {draft.citation_mode === 'shadow' && <ModeOptions name="jev-strategy" title="引用诊断方式" value={draft.citation_strategy}
              icon={Layers} tone="citation" nested description="选择声明的检查粒度。"
              options={[
                { value: 'per_unit', label: '逐条诊断', description: '分别检查每条声明与引用。' },
                { value: 'batch_choice', label: '批量诊断', description: '已有测试中输入用量更少；整批失败时不会自动逐条重试。' },
              ]}
              onChange={(value) => change('citation_strategy', value)} />}
            <details className="jev-advanced">
              <summary><FlaskConical className="h-4 w-4" aria-hidden /><span>进阶测试</span><span className="jev-advanced-hint">快速切换强制模式</span><ChevronDown className="jev-advanced-chevron h-4 w-4" aria-hidden /></summary>
              <div className="jev-advanced-body">
                <div><h3>一键强制测试</h3><p>将意图识别和重排设为强制 Jev，保存后生效。引用诊断保持当前选择。</p></div>
                <Button type="button" variant="outline" size="sm" className={outlineButtonClass} disabled={unavailable}
                  onClick={() => { setDraft({ ...draft, intent_mode: 'force', rerank_mode: 'force' }); setMessage(''); setError(null) }}>
                  <FlaskConical className="mr-2 h-4 w-4" aria-hidden />一键强制测试
                </Button>
              </div>
            </details>
          </fieldset>
        ) : null}
        <footer className={cn('jev-footer', dirty && 'has-changes')}>
          <div className="jev-save-status">
            <p role="status" aria-live="polite" className={cn(message && 'is-saved', dirty && 'is-dirty')}>
              {message ? <Check className="h-4 w-4" aria-hidden /> : <span className="jev-status-dot" aria-hidden />}
              {saving ? '正在保存…' : message || (dirty ? '有未保存的 Jev 更改' : saved ? '已读取服务端配置' : '请重新读取服务端配置')}
            </p>
            <span>Jev 设置单独保存，对所有会话生效并在重启后保留。正在处理的请求沿用原设置。</span>
          </div>
          <div className="jev-footer-actions">
            <Button type="button" variant="outline" size="sm" className={outlineButtonClass} disabled={loading || saving} onClick={() => void load()}>
              <RotateCcw className="mr-2 h-4 w-4" aria-hidden />{dirty ? '放弃更改' : '重新读取'}
            </Button>
            {draft ? <>
              <Button type="button" variant="outline" size="sm" className={outlineButtonClass} disabled={loading || saving}
                onClick={() => { setDraft({ ...draft, intent_mode: 'off', rerank_mode: 'off', citation_mode: 'off' }); setMessage(''); setError(null) }}>全部关闭</Button>
              <Button type="submit" size="sm" className="jev-button jev-button-primary" disabled={loading || saving || !dirty}>
                {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : <Save className="mr-2 h-4 w-4" aria-hidden />}
                保存 Jev 设置
              </Button>
            </> : error ? <Button type="button" variant="outline" size="sm" className={outlineButtonClass} disabled={loading || saving} onClick={() => void save(OFF_CONFIG)}>关闭全部并保存</Button> : null}
          </div>
        </footer>
      </form>
    </section>
  )
}
