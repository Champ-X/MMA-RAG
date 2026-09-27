import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { isAxiosError } from 'axios'
import { AlertCircle, Check, Loader2, Save, Zap } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { systemApi } from '@/services/api_client'
import type { JevConfig, JevSettingsResponse } from '@/types/jev'

const OFF_CONFIG: JevConfig = {
  intent_mode: 'off', rerank_mode: 'off', citation_mode: 'off', citation_strategy: 'per_unit',
}
const outlineButtonClass = 'min-h-12 rounded-[6px] border-slate-200 bg-white text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200 dark:hover:bg-slate-800'

function errorMessage(error: unknown) {
  if (isAxiosError(error) && typeof error.response?.data?.detail === 'string') {
    return error.response.data.detail
  }
  return '无法同步 Jev 设置，请检查后端连接后重试。'
}

function ModeOptions<T extends string>({ name, title, description, value, options, onChange }: {
  name: string
  title: string
  description: string
  value: T
  options: ReadonlyArray<{ value: T; label: string; disabled?: boolean }>
  onChange: (value: T) => void
}) {
  const id = useId()
  return (
    <fieldset aria-describedby={`${id}-help`}>
      <legend className="text-sm font-semibold text-slate-900 dark:text-slate-100">{title}</legend>
      <p id={`${id}-help`} className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">{description}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {options.map((option) => (
          <label key={option.value} className={cn(
            'flex min-h-12 items-center gap-2 rounded-[6px] border px-3 py-2 text-sm',
            value === option.value
              ? 'border-indigo-500 bg-indigo-50/70 text-indigo-900 dark:bg-indigo-950/40 dark:text-indigo-100'
              : 'border-slate-200 text-slate-700 dark:border-slate-700 dark:text-slate-300',
            option.disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer hover:border-indigo-400'
          )}>
            <input type="radio" name={name} value={option.value} checked={value === option.value}
              disabled={option.disabled} onChange={() => onChange(option.value)}
              className="h-4 w-4 accent-indigo-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500" />
            {option.label}
          </label>
        ))}
      </div>
    </fieldset>
  )
}

export function JevSettings({ onHasChangesChange }: { onHasChangesChange: (dirty: boolean) => void }) {
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

  return (
    <section id="jev" aria-labelledby="jev-title"
      className="scroll-mt-6 overflow-hidden rounded-[8px] border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-950">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-5 py-5 dark:border-slate-800 sm:px-6">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[6px] bg-indigo-50 text-indigo-600 dark:bg-indigo-950/60 dark:text-indigo-300"><Zap className="h-5 w-5" aria-hidden /></span>
          <div>
            <h2 id="jev-title" className="text-base font-semibold text-slate-950 dark:text-white">Jev 语义判断</h2>
            <p className="mt-1 text-sm leading-5 text-slate-500 dark:text-slate-400">选择在哪些环节使用 Jev，回答仍由对话模型生成。</p>
          </div>
        </div>
        <span className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">
          {loading ? '正在读取' : !saved ? '状态未知' : enabled ? '当前已启用' : '当前未启用'}
        </span>
      </header>
      <form onSubmit={submit} aria-busy={loading || saving}>
        {error && <div role="alert" className="mx-5 mt-5 flex items-start gap-2 rounded-[6px] bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /><span>{error}</span>
        </div>}
        {loading ? <p role="status" className="p-6 text-sm text-slate-500">正在读取服务端 Jev 设置…</p> : draft && saved ? (
          <fieldset disabled={saving} className="space-y-6 p-5 disabled:opacity-70 sm:p-6">
            <legend className="sr-only">Jev 使用设置</legend>
            <div className="text-xs leading-5 text-slate-500 dark:text-slate-400">
              <p className={unavailable ? 'text-amber-700 dark:text-amber-300' : ''}>
                {unavailable ? '未配置 API 密钥。请在服务端设置 TYPESAFE_API_KEY 并重启后端，再开启 Jev。' : `API 密钥已配置 · ${saved.model}（密钥状态不代表服务可用性）`}
              </p>
              <p>保存到当前服务，对所有会话生效；重启后保留。正在处理的请求沿用原设置。</p>
            </div>
            <ModeOptions name="jev-intent" title="意图识别" value={draft.intent_mode}
              description="简单问题优先使用 Jev 判断意图；复杂、有历史或不确定的请求继续使用原模型。"
              options={[{ value: 'off', label: '关闭' }, { value: 'adaptive', label: '开启简单问题快路径', disabled: unavailable }]}
              onChange={(value) => change('intent_mode', value)} />
            <ModeOptions name="jev-rerank" title="检索结果重排" value={draft.rerank_mode}
              description="对照评估会额外调用 Jev，但仍采用原重排结果。替换重排仅适合实验。"
              options={[{ value: 'off', label: '关闭 · 保留原重排' }, { value: 'shadow', label: '对照评估', disabled: unavailable }, { value: 'replace', label: '替换重排（实验）', disabled: unavailable }]}
              onChange={(value) => change('rerank_mode', value)} />
            {draft.rerank_mode === 'replace' && <p role="status" className="text-sm text-amber-700 dark:text-amber-300">已有评测中 Jev 重排质量低于 Qwen，建议优先使用对照评估。</p>}
            <ModeOptions name="jev-citation" title="回答引用诊断" value={draft.citation_mode}
              description="检查声明是否被所引来源支持。仅提供诊断，不改写或拦截答案；会增加回答完成等待。"
              options={[{ value: 'off', label: '关闭' }, { value: 'shadow', label: '开启引用诊断', disabled: unavailable }]}
              onChange={(value) => change('citation_mode', value)} />
            {draft.citation_mode === 'shadow' && <ModeOptions name="jev-strategy" title="引用诊断方式" value={draft.citation_strategy}
              description="批量方式在已有测试中减少输入用量；整批失败时不会自动逐条重试。"
              options={[{ value: 'per_unit', label: '逐条诊断' }, { value: 'batch_choice', label: '批量诊断' }]}
              onChange={(value) => change('citation_strategy', value)} />}
          </fieldset>
        ) : null}
        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 bg-slate-50/70 px-5 py-4 dark:border-slate-800 dark:bg-slate-900/35 sm:px-6">
          <p role="status" aria-live="polite" className="flex items-center gap-1.5 text-xs leading-5 text-slate-500 dark:text-slate-400">
            {message && <Check className="h-4 w-4 text-emerald-600" aria-hidden />}
            {saving ? '正在保存…' : message || (dirty ? '有未保存更改' : saved ? '已读取服务端配置' : '请重新读取服务端配置')}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" className={outlineButtonClass} disabled={loading || saving} onClick={() => void load()}>
              {dirty ? '放弃更改并重新读取' : '重新读取'}
            </Button>
            {draft ? <>
              <Button type="button" variant="outline" size="sm" className={outlineButtonClass} disabled={loading || saving}
                onClick={() => { setDraft({ ...draft, intent_mode: 'off', rerank_mode: 'off', citation_mode: 'off' }); setMessage(''); setError(null) }}>全部关闭</Button>
              <Button type="submit" size="sm" className="min-h-12 rounded-[6px] bg-indigo-600 text-white hover:bg-indigo-700" disabled={loading || saving || !dirty}>
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
