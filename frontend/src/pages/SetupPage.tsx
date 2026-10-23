import { translate as t, useTranslation } from '@/i18n'
import { LanguageSelect } from '@/i18n/LanguageSelect'
import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ArrowLeft, ArrowRight, Check, CheckCircle2, AlertCircle, Eye, EyeOff, FileText, Loader2, Terminal, Image, Headphones, Film, Route, LayoutGrid, KeyRound } from 'lucide-react'
import { getSetupToken, setSetupToken } from '@/lib/setupSession'
import { SetupError, setupApi, type Capability, type ModelPreparation, type Provider, type SetupDraft, type SetupStatus, type SetupTest } from '@/services/setup'
import { SetupSample } from '@/components/SetupSample'
import './setupPage.css'

const steps = ['选择能力', '连接模型', '验证与准备', '开始使用']
const stepDescriptions = ['选择需要处理的资料', '接入你的模型服务', '检查连接，准备本地模型', '带着第一份资料出发']
const capabilities: Array<{ id: Capability; title: string; description: string; models: string; icon: typeof FileText }> = [
  { id: 'text', title: '文档与对话', description: '检索文档证据，获得带引用的回答。', models: '基础能力 · BGE-M3', icon: FileText },
  { id: 'image', title: '图片', description: '理解图像内容，找到相关的图片。', models: '增加 CLIP', icon: Image },
  { id: 'audio', title: '音频', description: '转录与检索，回到录音中的片段。', models: '增加 CLAP', icon: Headphones },
  { id: 'video', title: '视频', description: '结合画面和语音，定位视频证据。', models: '增加 CLIP + CLAP', icon: Film },
]
const providerNames: Record<Provider, string> = { deepseek: 'DeepSeek', siliconflow: 'SiliconFlow', aliyun_bailian: '阿里云百炼', openrouter: 'OpenRouter' }
const providerLinks: Record<Provider, string> = { deepseek: 'https://platform.deepseek.com/api_keys', siliconflow: 'https://cloud.siliconflow.cn/account/ak', aliyun_bailian: 'https://bailian.console.aliyun.com/', openrouter: 'https://openrouter.ai/settings/keys' }
const providerHints: Record<Provider, string> = { deepseek: '默认负责对话、文档理解和 Pi Agent。', siliconflow: '负责文本向量、重排及所选图片模型。', aliyun_bailian: '用于所选音频、视频或图片理解模型。', openrouter: '用于已选择的 OpenRouter 模型。' }
const modelNames: Record<string, string> = { bge_m3: 'BGE-M3 · 文本稀疏检索', clip: 'CLIP · 图片检索', clap: 'CLAP · 音频检索' }
const errorMessage = (error: unknown) => error instanceof Error ? error.message : t("操作未完成，请重试。")
const modelPhases: Record<string, string> = { cache: '检查缓存', metadata: '连接下载源', download: '下载文件', verify: '校验文件', load: '载入模型', load_download: '下载与载入', inference: '推理验证', artifacts: '保存验证结果' }
const bytes = (value: number) => value >= 1024 ** 3 ? `${(value / 1024 ** 3).toFixed(2)} GiB` : `${Math.round(value / 1024 ** 2)} MiB`

function FragmentArtwork() {
  useTranslation()
  const id = useId()
  return <div className="setup-fragments" aria-hidden="true">
    <svg className="setup-fragment-illustration" viewBox="0 0 320 240" fill="none" focusable="false">
      <defs>
        <filter id={`${id}-shadow`} x="-35%" y="-30%" width="180%" height="180%"><feDropShadow dx="0" dy="6" stdDeviation="5" floodColor="#26334b" floodOpacity=".1" /></filter>
        <linearGradient id={`${id}-image`} x1="0" y1="0" x2="1" y2="1"><stop stopColor="var(--setup-accent-soft)" /><stop offset="1" stopColor="var(--setup-success-soft)" /></linearGradient>
      </defs>
      <ellipse cx="164" cy="119" rx="118" ry="92" fill="var(--setup-accent-soft)" opacity=".5" />
      <path d="M40 84C20 135 58 206 147 208M189 26c55-8 97 20 104 68" stroke="var(--setup-border)" strokeDasharray="3 6" strokeLinecap="round" />
      <g transform="rotate(-11 77 64)" filter={`url(#${id}-shadow)`}>
        <rect x="28" y="29" width="100" height="75" rx="12" fill="var(--setup-surface)" stroke="var(--setup-border)" />
        <rect x="41" y="42" width="22" height="24" rx="5" fill="var(--setup-accent-soft)" />
        <path d="M47 49h9m-9 5h9m-9 5h5" stroke="var(--setup-accent)" strokeWidth="1.5" strokeLinecap="round" />
        <path d="M72 48h40m-40 9h28M42 80h69M42 88h45" stroke="var(--setup-border)" strokeWidth="3" strokeLinecap="round" />
      </g>
      <g transform="rotate(5 180 119)">
        <rect x="107" y="41" width="143" height="167" rx="16" fill="var(--setup-accent-soft)" stroke="var(--setup-border)" />
      </g>
      <g filter={`url(#${id}-shadow)`}>
        <rect x="100" y="34" width="142" height="167" rx="16" fill="var(--setup-surface)" stroke="var(--setup-border)" />
        <rect x="117" y="51" width="27" height="27" rx="8" fill="var(--setup-accent-soft)" />
        <path d="m124 58 13 0v13h-13zM130.5 58v13M124 64.5h13" stroke="var(--setup-accent)" strokeWidth="1.4" strokeLinejoin="round" />
        <text x="153" y="69" fill="var(--setup-ink)" fontSize="12" fontWeight="600">{t("知识笔记")}</text>
        <path d="M118 96h104m-104 10h86m-86 10h95" stroke="var(--setup-border)" strokeWidth="3" strokeLinecap="round" />
        <rect x="117" y="133" width="108" height="32" rx="7" fill="var(--setup-accent-soft)" />
        <path d="M127 144h42m-42 9h70" stroke="var(--setup-accent)" strokeOpacity=".45" strokeWidth="3" strokeLinecap="round" />
        <circle cx="121" cy="182" r="3" fill="var(--setup-success)" />
        <path d="M130 182h46" stroke="var(--setup-border)" strokeWidth="3" strokeLinecap="round" />
      </g>
      <g transform="rotate(-8 68 157)" filter={`url(#${id}-shadow)`}>
        <rect x="20" y="119" width="94" height="76" rx="12" fill="var(--setup-surface)" stroke="var(--setup-border)" />
        <rect x="28" y="127" width="78" height="51" rx="7" fill={`url(#${id}-image)`} />
        <circle cx="88" cy="141" r="6" fill="var(--setup-accent)" opacity=".3" />
        <path d="m28 167 23-24 18 20 12-12 25 25v2H28Z" fill="var(--setup-success)" opacity=".4" />
        <path d="M31 186h35" stroke="var(--setup-border)" strokeWidth="3" strokeLinecap="round" />
      </g>
      <g transform="rotate(9 263 94)" filter={`url(#${id}-shadow)`}>
        <rect x="215" y="69" width="87" height="48" rx="14" fill="var(--setup-surface)" stroke="var(--setup-border)" />
        <path d="M229 90v6m6-12v18m6-22v26m6-18v10m6-12v14m6-23v32m6-25v18m6-15v12m6-10v8m6-14v20m6-13v6" stroke="var(--setup-accent)" strokeWidth="2.5" strokeLinecap="round" />
      </g>
      <g transform="rotate(8 262 176)" filter={`url(#${id}-shadow)`}>
        <rect x="233" y="153" width="57" height="44" rx="12" fill="var(--setup-success-soft)" stroke="var(--setup-border)" />
        <path d="m256 167 13 8-13 8Z" fill="var(--setup-success)" opacity=".8" />
      </g>
      <path d="M57 213h7m-3.5-3.5v7M274 42h7m-3.5-3.5v7" stroke="var(--setup-accent)" strokeOpacity=".45" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
    <p>Every fragment <strong>finds its place.</strong></p>
  </div>
}

function SourceConfiguration() {
  useTranslation()
  return <main className="setup-source">
    <section className="setup-source-panel" aria-labelledby="source-title">
      <div className="setup-source-hero">
        <div className="setup-source-copy">
          <span className="setup-mode-label"><Terminal size={15} aria-hidden />{t("项目环境配置")}</span>
          <h1 id="source-title">{t("沿用项目配置，")}<br /><span>{t("继续你的工作。")}</span></h1>
          <p>{t("当前服务沿用项目的环境配置。")}<br />{t("模型选择与检索偏好，可以直接在设置中调整。")}</p>
        </div>
        <FragmentArtwork />
      </div>
      <div className="setup-destinations">
        <Link to="/settings?section=models" className="setup-destination is-primary">
          <span className="setup-destination-icon"><Route size={21} aria-hidden /></span>
          <span><strong>{t("模型与路由")}</strong><small>{t("选择模型，检查服务连接")}</small></span><ArrowRight size={18} aria-hidden />
        </Link>
        <Link to="/" className="setup-destination">
          <span className="setup-destination-icon"><LayoutGrid size={21} aria-hidden /></span>
          <span><strong>{t("返回工作台")}</strong><small>{t("继续整理资料与提问")}</small></span><ArrowRight size={18} aria-hidden />
        </Link>
      </div>
      <details className="setup-source-help">
        <summary><KeyRound size={15} aria-hidden />{t("需要更换 API Key？")}</summary>
        <p>{t("请在项目环境配置中更新对应服务商的密钥，并按当前部署方式重启相关服务，再到「模型与路由」测试连接。")}</p>
      </details>
    </section>
    <p className="setup-source-caption">{t("此配置方式无需经过首次安装向导。")}</p>
  </main>
}

function ModelProgress({ name, value }: { name: string; value: ModelPreparation }) {
  useTranslation()
  const failed = ['error', 'interrupted'].includes(value.state)
  const downloading = value.phase === 'download' && value.state === 'running'
  const measurable = downloading && Number.isFinite(value.total_bytes) && Number(value.total_bytes) > 0 && Number.isFinite(value.downloaded_bytes)
  const done = Math.min(value.downloaded_bytes || 0, value.total_bytes || 0)
  return <li className={`setup-model ${failed ? 'has-error' : ''}`}>
    <span className={failed ? 'setup-fail' : value.state === 'ready' ? 'setup-pass' : ''} aria-hidden>{value.state === 'ready' ? <CheckCircle2 size={18} /> : failed ? <AlertCircle size={18} /> : value.state === 'running' ? <Loader2 size={18} className="setup-spin" /> : '·'}</span>
    <div className="setup-model-body">
      <div className="setup-model-heading"><strong>{t(modelNames[name] || name)}</strong><span>{failed ? value.state === 'interrupted' ? t("已中断") : t("需要处理") : value.state === 'ready' ? t("已就绪") : t(modelPhases[value.phase || ''] || '等待准备')}</span></div>
      <p role={failed ? 'alert' : 'status'}>{value.message ? t(value.message) : null}</p>
      {measurable && <><progress className="setup-progress" aria-label={t("{{name}} 文件下载进度", { name: name })} max={value.total_bytes} value={done} /><div className="setup-model-metrics"><span>{bytes(done)} / {bytes(value.total_bytes!)}</span><span>{Math.floor(done / value.total_bytes! * 100)}%</span></div></>}
      {downloading && !measurable && value.files_total !== undefined && <p>{value.files_completed || 0} / {value.files_total}  {t("个文件已下载")}</p>}
      {downloading && (value.idle_seconds || 0) >= 20 && <p>{t("等待新的下载数据，已下载部分会保留。")}</p>}
      {value.state === 'running' && ['load', 'load_download', 'inference'].includes(value.phase || '') && <p>{t("首次载入与 CPU 推理可能需要几分钟。")}</p>}
      {failed && value.hint && <p className="setup-model-help">{t(value.hint)}</p>}
      {failed && value.error_code && <details className="setup-model-diagnostic"><summary>{t("查看诊断信息")}</summary><code>{value.error_code}{value.error_type && ` / ${value.error_type}`}</code><p>{t("后端日志")}</p><code>tessmora logs --service backend --tail 160</code></details>}
    </div>
  </li>
}

export default function SetupPage() {
  useTranslation()
  const [searchParams] = useSearchParams()
  const editing = searchParams.get('edit') === 'services'
  const [status, setStatus] = useState<SetupStatus | null>(null)
  const [step, setStep] = useState(0)
  const [selected, setSelected] = useState<Capability[]>(['text'])
  const [credentials, setCredentials] = useState<Partial<Record<Provider, string>>>({})
  const [revealed, setRevealed] = useState<Partial<Record<Provider, boolean>>>({})
  const [test, setTest] = useState<SetupTest | null>(null)
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState('')
  const [watchPreparation, setWatchPreparation] = useState(false)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [authorized, setAuthorized] = useState(Boolean(getSetupToken()))
  const [token, setToken] = useState('')
  const heading = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    let active = true
    setupApi.status().then(result => {
      if (!active) return
      setStatus(result)
      setSelected(result.capabilities)
      setSaved(result.tested)
      setWatchPreparation(result.progress.state === 'running')
      setStep(result.ready ? editing ? 1 : 3 : result.tested ? 2 : 0)
      setError('')
    }).catch(reason => { if (active) setError(errorMessage(reason)) })
    return () => { active = false }
  }, [attempt, editing])

  useEffect(() => { heading.current?.focus() }, [step, status?.managed])

  useEffect(() => {
    if (!watchPreparation) return
    let active = true
    let timer: ReturnType<typeof setTimeout>
    const check = async () => {
      try {
        const result = await setupApi.status()
        if (!active) return
        setStatus(result)
        setError('')
        if (result.ready) setStep(3)
        if (result.progress.state !== 'running') { setWatchPreparation(false); return }
      } catch {
        if (active) setError(t("与服务的连接暂时中断。准备任务会继续，页面正在重新连接。"))
      }
      if (active) timer = setTimeout(check, 2500)
    }
    void check()
    return () => { active = false; clearTimeout(timer) }
  }, [watchPreparation])

  const invalidate = () => { setTest(null); setSaved(false); setError('') }
  const handleError = (reason: unknown) => {
    setError(errorMessage(reason))
    if (reason instanceof SetupError && reason.status === 401) setAuthorized(false)
  }
  const draft = (): SetupDraft => ({ capabilities: selected, credentials: Object.fromEntries(Object.entries(credentials).filter(([, value]) => value?.trim()).map(([key, value]) => [key, value!.trim()])) })
  const mediaTasks = Array.from(new Set(selected.flatMap(capability => capability === 'image' ? ['image_captioning'] : capability === 'audio' ? ['audio_transcription'] : capability === 'video' ? ['video_parsing', 'image_captioning', 'audio_transcription'] : [])))
  const mediaProviders = mediaTasks.map(task => {
    const model = status?.task_models[task] || ''
    const configuredProvider = status?.models?.find(value => value.id === model)?.provider
    return configuredProvider || (model.includes(':') ? model.split(':')[0] as Provider : 'siliconflow')
  })
  const requiredProviders = Array.from(new Set<Provider>(status?.capability_checks ? selected.flatMap(capability => status.capability_checks?.[capability] || []).map(check => check.provider) : [
    ...(status?.checks.filter(check => !['image_captioning', 'audio_transcription', 'video_parsing'].includes(check.task)).map(check => check.provider) || ['deepseek', 'siliconflow'] as Provider[]),
    ...mediaProviders,
  ]))

  const runTest = async () => {
    setBusy(t("正在逐项验证模型连接与 Pi 工具调用，可能需要几分钟…"))
    setError('')
    setTest(null)
    setSaved(false)
    try {
      const result = await setupApi.test(draft())
      setTest(result)
      if (!result.success) setError(t("部分连接未通过。返回上一步检查密钥、账户额度或模型权限，再重新测试。"))
    } catch (reason) { handleError(reason) }
    finally { setBusy('') }
  }

  const prepare = async () => {
    setBusy(t("正在保存配置并开始准备…"))
    setError('')
    try {
      if (!saved) {
        if (!test?.success || !test.test_receipt) throw new Error(t("请先完成连接测试。"))
        const result = await setupApi.save({ ...draft(), test_receipt: test.test_receipt })
        setStatus(result)
        setCredentials({})
        setSaved(true)
      }
      const progress = await setupApi.prepare()
      setStatus(current => current ? { ...current, progress } : current)
      // Begin reconnecting as soon as the job is accepted, even if the next status request fails.
      setWatchPreparation(true)
    } catch (reason) { handleError(reason) }
    finally { setBusy('') }
  }

  const unlock = async (event: FormEvent) => {
    event.preventDefault()
    setSetupToken(token.trim())
    setBusy(t("正在验证安装会话…"))
    try { await setupApi.config(); setAuthorized(true); setToken(''); setError('') }
    catch (reason) { setSetupToken(''); setError(errorMessage(reason)) }
    finally { setBusy('') }
  }

  const preparing = watchPreparation || status?.progress.state === 'running'
  const locked = Boolean(busy) || preparing
  return <div className="tessmora-setup">
    <header className={`setup-topbar ${status && !status.managed ? 'is-source' : ''}`}>
      <Link to="/" className="setup-wordmark">
        <span className="setup-brand-emblem"><img src="/tessmora-logo.png" alt="" /></span>
        <span className="setup-brand-copy"><strong>Tessmora</strong><small>{status?.managed ? t("服务连接与能力") : t("你的知识工作台")}</small></span>
      </Link>
      <div className="setup-language"><LanguageSelect compact /></div>
      {status && !status.setup_required && <Link to="/settings?section=models" className="setup-back-link"><ArrowLeft size={15} aria-hidden />{t("返回设置")}</Link>}
    </header>
    {status && !status.managed ? <SourceConfiguration /> : !status ? <main className="setup-loading" aria-busy={!error}>
      {error ? <AlertCircle size={28} aria-hidden /> : <Loader2 size={28} className="setup-spin" aria-hidden />}
      <h1>{error ? t("暂时无法读取配置") : t("正在连接你的工作台")}</h1>
      <p role={error ? 'alert' : 'status'}>{error || t("正在读取服务状态，请稍候…")}</p>
      {error && <button className="setup-button primary" onClick={() => { setError(''); setAttempt(value => value + 1) }}>{t("重新连接")}</button>}
    </main> : <main className="setup-shell">
      <aside className="setup-sidebar" aria-label={t("服务配置")}>
        <p className="setup-eyebrow">{editing ? t("调整你的配置") : t("配置你的工作台")}</p>
        <ol className="setup-steps" aria-label={t("配置进度")}>{steps.map((title, index) => <li key={title} aria-current={step === index ? 'step' : undefined} className={index === step ? 'current' : index < step ? 'complete' : ''}>
          <span className="setup-step-number">{index < step ? <Check size={15} /> : `0${index + 1}`}</span><span><strong>{t(title)}</strong><small>{t(stepDescriptions[index])}</small></span>
        </li>)}</ol>
        <div className="setup-sidebar-note"><Terminal size={17} aria-hidden /><p>{t("与终端向导共用配置。")}<br />{t("已保存的密钥与模型缓存会保留。")}</p></div>
      </aside>
      <section className="setup-main" aria-labelledby="setup-heading" aria-busy={Boolean(busy)}>
        <header className="setup-panel-header">
          <div className="setup-panel-position"><span>{t("步骤")} {step + 1} / 4</span><span className="setup-step-meter" aria-hidden>{steps.map((_, index) => <i key={index} className={index <= step ? 'filled' : ''} />)}</span></div>
          <h1 id="setup-heading" ref={heading} tabIndex={-1}>{[t("从你需要的能力开始"), t("连接你的模型服务"), t("确认一切准备就绪"), t("你的工作台已就绪")][step]}</h1>
          <p className="setup-lead">{[t("文档与对话是起点。其他能力按需启用，之后也能添加。"), t("填写所需服务的 API Key。已保存的密钥留空即可保留。"), t("用真实请求检查连接，再准备本地检索模型。"), t("从一份小文档开始，体验提问、回答和证据引用。")][step]}</p>
        </header>
        <div className="setup-panel-body">
          {!authorized && step < 3 && <form className="setup-unlock" method="post" onSubmit={unlock}>
            <label htmlFor="setup-token"><KeyRound size={16} aria-hidden />{t("连接安装会话")}</label><p id="setup-token-help">{t("运行")} <code>tessmora open</code>  {t("重新打开页面，或输入此实例的安装令牌。")}</p><div className="setup-unlock-row"><input id="setup-token" name="setup-token" type="password" autoComplete="off" autoCorrect="off" autoCapitalize="none" spellCheck={false} aria-describedby="setup-token-help" value={token} onChange={event => setToken(event.target.value)} required /><button className="setup-button" disabled={Boolean(busy)}>{t("连接")}</button></div>
          </form>}

          {step === 0 && <><fieldset className="setup-capabilities"><legend className="sr-only">{t("选择使用能力")}</legend>{capabilities.map(item => <label key={item.id} className={`setup-capability ${selected.includes(item.id) ? 'selected' : ''}`}>
            <input type="checkbox" name="capabilities" value={item.id} aria-label={t(item.title)} checked={selected.includes(item.id)} disabled={item.id === 'text'} onChange={event => { setSelected(current => event.target.checked ? [...current, item.id] : current.filter(value => value !== item.id)); invalidate() }} />
            <span className="setup-capability-icon"><item.icon size={23} strokeWidth={1.6} aria-hidden /></span>
            <strong>{t(item.title)}</strong><span className="setup-capability-description">{t(item.description)}</span><small>{t(item.models)}</small>
          </label>)}</fieldset><p className="setup-hint">{t("首次下载可能需要数 GB 空间；准备过程中会保留缓存，便于中断后继续。")}</p><div className="setup-actions"><button className="setup-button primary" onClick={() => setStep(1)}>{t("继续")} <ArrowRight size={17} /></button></div></>}

          {step === 1 && <form method="post" onSubmit={event => { event.preventDefault(); setStep(2) }}>
            <div className="setup-providers">{requiredProviders.map(provider => <div className="setup-provider" key={provider}>
              <div className="setup-provider-heading"><label htmlFor={`key-${provider}`}>{t(providerNames[provider])}</label><a href={providerLinks[provider]} target="_blank" rel="noreferrer">{t("获取 API Key ↗")}</a></div>
              <p id={`key-${provider}-help`}>{t(providerHints[provider])}{status.providers[provider]?.configured && <span className="setup-saved">  {t("已保存")}</span>}</p>
              <div className="setup-key-input"><input id={`key-${provider}`} name={`key-${provider}`} aria-describedby={`key-${provider}-help`} autoCapitalize="none" autoCorrect="off" type={revealed[provider] ? 'text' : 'password'} autoComplete="off" spellCheck={false} required={!status.providers[provider]?.configured} value={credentials[provider] || ''} placeholder={status.providers[provider]?.configured ? t("留空保留已有密钥") : t("粘贴 API Key")} onChange={event => { setCredentials(current => ({ ...current, [provider]: event.target.value })); invalidate() }} /><button type="button" aria-label={t("{{value1}} {{value2}} 密钥", { value1: revealed[provider] ? t("隐藏") : t("显示"), value2: t(providerNames[provider]) })} aria-pressed={Boolean(revealed[provider])} onClick={() => setRevealed(current => ({ ...current, [provider]: !current[provider] }))}>{revealed[provider] ? <EyeOff size={18} /> : <Eye size={18} />}</button></div>
            </div>)}</div><p className="setup-hint">{t("密钥只发送给当前 Tessmora 服务，并保存在安装目录。连接测试会产生少量模型调用费用。")}</p><div className="setup-actions"><button type="button" className="setup-button" onClick={() => setStep(0)}><ArrowLeft size={17} />{t("上一步")}</button><button className="setup-button primary">{t("继续")} <ArrowRight size={17} /></button></div>
          </form>}

          {step === 2 && <>
            <section className="setup-check-group"><h3><span>01</span>  {t("模型连接")}</h3>{test ? <ul className="setup-checks">{test.results.map((result, index) => <li key={index}><span className={result.success ? 'setup-pass' : 'setup-fail'}>{result.success ? <CheckCircle2 size={18} /> : '!'}</span><div><strong>{result.model}</strong><p>{t(result.message)}</p></div></li>)}</ul> : <p>{saved ? t("已保存的配置通过了连接测试。") : t("检查文本生成、向量、重排，以及所选能力的模型连接。")}</p>}
              <button className="setup-button" disabled={locked || !authorized} onClick={runTest}>{test || saved ? t("重新测试连接") : t("开始连接测试")}</button>
            </section>
            <section className="setup-check-group"><h3><span>02</span>  {t("存储与本地模型准备")}</h3><p>{t("先检查存储并准备检索集合，再下载所需模型并验证推理。已有缓存会保留。")}</p>
              {status.progress.stage === 'storage' && status.progress.state === 'running' && <p className="setup-live" role="status"><Loader2 size={17} className="setup-spin" aria-hidden />{t(status.progress.message || "正在检查存储并准备检索集合…")}</p>}
              {status.progress.state === 'error' && status.progress.error_code === 'STORAGE_UNAVAILABLE' && status.progress.message && <div className="setup-error" role="alert"><strong>{t(status.progress.message)}</strong>{status.progress.hint && <p>{t(status.progress.hint)}</p>}</div>}
              {status.progress.stage !== 'storage' && status.progress.total > 0 && <><div className="setup-model-overview"><span>{t("本地模型")}</span><span>{status.progress.completed} / {status.progress.total}  {t("已就绪")}</span></div><ul className="setup-checks setup-models">{Object.entries(status.progress.models).map(([model, value]) => <ModelProgress key={model} name={model} value={value} />)}</ul></>}
              <button className="setup-button primary" disabled={locked || !authorized || (!saved && !test?.success)} onClick={prepare}>{preparing ? t("正在准备…") : status.progress.state === 'interrupted' || status.progress.state === 'error' ? t("继续准备") : t("保存并准备")}<ArrowRight size={17} /></button>
            </section>
            <div className="setup-actions"><button className="setup-button" disabled={locked} onClick={() => setStep(1)}><ArrowLeft size={17} />{t("上一步")}</button>{status.ready && <button className="setup-button primary" onClick={() => setStep(3)}>{t("完成")} <ArrowRight size={17} /></button>}</div>
          </>}

          {step === 3 && <><div className="setup-ready"><CheckCircle2 size={24} /><div><strong>{t("连接已验证，模型已准备")}</strong><p>{t("以后运行")} <code>tessmora start</code>  {t("即可重新启动。")}</p></div></div><SetupSample /><div className="setup-actions"><button className="setup-button" onClick={() => setStep(0)}>{t("调整配置")}</button><Link className="setup-button primary" to="/">{t("进入工作台")} <ArrowRight size={17} /></Link></div></>}
          {busy && <p className="setup-live" role="status"><Loader2 size={17} className="setup-spin" />{busy}</p>}
          {error && <p className="setup-error" role="alert">{error}</p>}
        </div>
        <footer className="setup-footer"><FileText size={14} aria-hidden /><span>{t("文档保存在所选安装目录。模型调用会将所需内容发送给配置的服务商。")}</span></footer>
      </section>
    </main>}
  </div>
}
