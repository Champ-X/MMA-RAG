import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, ArrowRight, Check, CheckCircle2, AlertCircle, Eye, EyeOff, FileText, Loader2, Terminal } from 'lucide-react'
import { getSetupToken, setSetupToken } from '@/lib/setupSession'
import { SetupError, setupApi, type Capability, type ModelPreparation, type Provider, type SetupDraft, type SetupStatus, type SetupTest } from '@/services/setup'
import { SetupSample } from '@/components/SetupSample'
import './setupPage.css'

const steps = ['选择能力', '连接模型', '验证与准备', '开始使用']
const capabilities: Array<{ id: Capability; title: string; description: string; models: string }> = [
  { id: 'text', title: '文档与对话', description: '导入文档、检索证据，并获得带引用的回答。', models: '必选 · BGE-M3' },
  { id: 'image', title: '图片', description: '读懂图像内容，并检索相关图片。', models: '增加 CLIP' },
  { id: 'audio', title: '音频', description: '转录、检索录音，回到对应的声音片段。', models: '增加 CLAP' },
  { id: 'video', title: '视频', description: '理解画面和语音，定位视频中的证据。', models: '增加 CLIP + CLAP' },
]
const providerNames: Record<Provider, string> = { deepseek: 'DeepSeek', siliconflow: 'SiliconFlow', aliyun_bailian: '阿里云百炼', openrouter: 'OpenRouter' }
const providerLinks: Record<Provider, string> = { deepseek: 'https://platform.deepseek.com/api_keys', siliconflow: 'https://cloud.siliconflow.cn/account/ak', aliyun_bailian: 'https://bailian.console.aliyun.com/', openrouter: 'https://openrouter.ai/settings/keys' }
const providerHints: Record<Provider, string> = { deepseek: '默认负责对话、文档理解和 Pi Agent。', siliconflow: '负责文本向量、重排及所选图片模型。', aliyun_bailian: '用于所选音频、视频或图片理解模型。', openrouter: '用于已选择的 OpenRouter 模型。' }
const modelNames: Record<string, string> = { bge_m3: 'BGE-M3 · 文本稀疏检索', clip: 'CLIP · 图片检索', clap: 'CLAP · 音频检索' }
const errorMessage = (error: unknown) => error instanceof Error ? error.message : '操作未完成，请重试。'
const modelPhases: Record<string, string> = { cache: '检查缓存', metadata: '连接下载源', download: '下载文件', verify: '校验文件', load: '载入模型', load_download: '下载与载入', inference: '推理验证', artifacts: '保存验证结果' }
const bytes = (value: number) => value >= 1024 ** 3 ? `${(value / 1024 ** 3).toFixed(2)} GiB` : `${Math.round(value / 1024 ** 2)} MiB`

function ModelProgress({ name, value }: { name: string; value: ModelPreparation }) {
  const failed = ['error', 'interrupted'].includes(value.state)
  const downloading = value.phase === 'download' && value.state === 'running'
  const measurable = downloading && Number.isFinite(value.total_bytes) && Number(value.total_bytes) > 0 && Number.isFinite(value.downloaded_bytes)
  const done = Math.min(value.downloaded_bytes || 0, value.total_bytes || 0)
  return <li className={`setup-model ${failed ? 'has-error' : ''}`}>
    <span className={failed ? 'setup-fail' : value.state === 'ready' ? 'setup-pass' : ''} aria-hidden>{value.state === 'ready' ? <CheckCircle2 size={18} /> : failed ? <AlertCircle size={18} /> : value.state === 'running' ? <Loader2 size={18} className="setup-spin" /> : '·'}</span>
    <div className="setup-model-body">
      <div className="setup-model-heading"><strong>{modelNames[name] || name}</strong><span>{value.state === 'ready' ? '已就绪' : modelPhases[value.phase || ''] || '等待准备'}</span></div>
      <p role={failed ? 'alert' : 'status'}>{value.message}</p>
      {measurable && <><progress className="setup-progress" aria-label={`${name} 文件下载进度`} max={value.total_bytes} value={done} /><div className="setup-model-metrics"><span>{bytes(done)} / {bytes(value.total_bytes!)}</span><span>{Math.floor(done / value.total_bytes! * 100)}%</span></div></>}
      {downloading && !measurable && value.files_total !== undefined && <p>{value.files_completed || 0} / {value.files_total} 个文件已下载</p>}
      {downloading && (value.idle_seconds || 0) >= 20 && <p>等待新的下载数据，已下载部分会保留。</p>}
      {value.state === 'running' && ['load', 'load_download', 'inference'].includes(value.phase || '') && <p>首次载入与 CPU 推理可能需要几分钟。</p>}
      {failed && value.hint && <p className="setup-model-help">{value.hint}</p>}
      {failed && value.error_code && <details className="setup-model-diagnostic"><summary>查看诊断信息</summary><code>{value.error_code}{value.error_type && ` / ${value.error_type}`}</code><p>后端日志</p><code>tessmora logs --service backend --tail 160</code></details>}
    </div>
  </li>
}

export default function SetupPage() {
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
      setStep(result.ready ? 3 : result.tested ? 2 : 0)
      setError('')
    }).catch(reason => { if (active) setError(errorMessage(reason)) })
    return () => { active = false }
  }, [attempt])

  useEffect(() => { heading.current?.focus() }, [step])

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
        if (active) setError('与服务的连接暂时中断。准备任务会继续，页面正在重新连接。')
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
    setBusy('正在逐项验证模型连接与 Pi 工具调用，可能需要几分钟…')
    setError('')
    setTest(null)
    setSaved(false)
    try {
      const result = await setupApi.test(draft())
      setTest(result)
      if (!result.success) setError('部分连接未通过。返回上一步检查密钥、账户额度或模型权限，再重新测试。')
    } catch (reason) { handleError(reason) }
    finally { setBusy('') }
  }

  const prepare = async () => {
    setBusy('正在保存配置并开始准备…')
    setError('')
    try {
      if (!saved) {
        if (!test?.success || !test.test_receipt) throw new Error('请先完成连接测试。')
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
    setBusy('正在验证安装会话…')
    try { await setupApi.config(); setAuthorized(true); setToken(''); setError('') }
    catch (reason) { setSetupToken(''); setError(errorMessage(reason)) }
    finally { setBusy('') }
  }

  const preparing = watchPreparation || status?.progress.state === 'running'
  const locked = Boolean(busy) || preparing
  return <div className="tessmora-setup">
    <header className="setup-topbar"><Link to="/" className="setup-wordmark">Tessmora<span>初次见面，或重新出发。</span></Link><span className="setup-local"><span />你的知识工作台</span></header>
    <main className="setup-shell">
      <aside className="setup-sidebar">
        <div><p className="setup-eyebrow">LET’S GET STARTED</p><h1>让知识，<br />有迹可循。</h1><p className="setup-intro">几个步骤，把 Tessmora 配置成你的样子。</p></div>
        <ol className="setup-steps" aria-label="配置进度">{steps.map((title, index) => <li key={title} aria-current={step === index ? 'step' : undefined} className={index === step ? 'current' : index < step ? 'complete' : ''}>
          <span className="setup-step-number">{index < step ? <Check size={16} /> : `0${index + 1}`}</span><span>{title}</span>
        </li>)}</ol>
        <p className="setup-side-note"><Terminal size={17} />与终端向导共用配置。<br />稍后可随时回来调整。</p>
      </aside>
      <section className="setup-main" aria-busy={Boolean(busy)}>
        {!status ? <div className="setup-loading"><Loader2 className="setup-spin" /><p role="status">{error || '正在读取服务配置…'}</p>{error && <button className="setup-button" onClick={() => setAttempt(value => value + 1)}>重新连接</button>}</div> : !status.managed ? <>
          <p className="setup-eyebrow">SOURCE INSTALLATION</p><h2 ref={heading} tabIndex={-1}>当前使用源码配置</h2><p className="setup-lead">此安装沿用项目的环境配置。模型和检索选项可以在设置中调整。</p><Link className="setup-button primary" to="/settings">进入设置 <ArrowRight size={17} /></Link>
        </> : <>
          <p className="setup-eyebrow">STEP 0{step + 1} / 04</p>
          <h2 ref={heading} tabIndex={-1}>{['先从你需要的能力开始', '连接你的模型服务', '确认一切都准备好了', '你的工作台已就绪'][step]}</h2>
          <p className="setup-lead">{['文档与对话是起点。其他能力按需启用，之后也能添加。', '填写所需服务的 API Key。已保存的密钥留空即可保留。', '用真实请求检查连接，再准备本地检索模型。', '从一份小文档开始，体验提问、回答和证据引用。'][step]}</p>

          {!authorized && step < 3 && <form className="setup-unlock" onSubmit={unlock}>
            <label htmlFor="setup-token">连接安装会话</label><p>运行 <code>tessmora open</code> 重新打开此页面，或粘贴此实例的安装令牌。</p><div className="setup-unlock-row"><input id="setup-token" name="setup-token" type="password" autoComplete="off" autoCapitalize="none" spellCheck={false} value={token} onChange={event => setToken(event.target.value)} required /><button className="setup-button" disabled={Boolean(busy)}>连接</button></div>
          </form>}

          {step === 0 && <><fieldset className="setup-capabilities"><legend className="sr-only">选择使用能力</legend>{capabilities.map(item => <label key={item.id} className={`setup-capability ${selected.includes(item.id) ? 'selected' : ''}`}>
            <input type="checkbox" checked={selected.includes(item.id)} disabled={item.id === 'text'} onChange={event => { setSelected(current => event.target.checked ? [...current, item.id] : current.filter(value => value !== item.id)); invalidate() }} />
            <span><strong>{item.title}</strong><span>{item.description}</span><small>{item.models}</small></span>
          </label>)}</fieldset><p className="setup-hint">首次下载可能需要数 GB 空间；准备过程中会保留缓存，便于中断后继续。</p><div className="setup-actions"><button className="setup-button primary" onClick={() => setStep(1)}>继续 <ArrowRight size={17} /></button></div></>}

          {step === 1 && <form onSubmit={event => { event.preventDefault(); setStep(2) }}>
            <div className="setup-providers">{requiredProviders.map(provider => <div className="setup-provider" key={provider}>
              <div className="setup-provider-heading"><label htmlFor={`key-${provider}`}>{providerNames[provider]}</label><a href={providerLinks[provider]} target="_blank" rel="noreferrer">获取 API Key ↗</a></div>
              <p>{providerHints[provider]}{status.providers[provider]?.configured && <span className="setup-saved"> 已保存</span>}</p>
              <div className="setup-key-input"><input id={`key-${provider}`} name={`key-${provider}`} autoCapitalize="none" type={revealed[provider] ? 'text' : 'password'} autoComplete="off" spellCheck={false} value={credentials[provider] || ''} placeholder={status.providers[provider]?.configured ? '留空保留已有密钥' : '粘贴 API Key'} onChange={event => { setCredentials(current => ({ ...current, [provider]: event.target.value })); invalidate() }} /><button type="button" aria-label={`${revealed[provider] ? '隐藏' : '显示'} ${providerNames[provider]} 密钥`} aria-pressed={Boolean(revealed[provider])} onClick={() => setRevealed(current => ({ ...current, [provider]: !current[provider] }))}>{revealed[provider] ? <EyeOff size={18} /> : <Eye size={18} />}</button></div>
            </div>)}</div><p className="setup-hint">密钥只发送给当前 Tessmora 服务，并保存在安装目录。连接测试会产生少量模型调用费用。</p><div className="setup-actions"><button type="button" className="setup-button" onClick={() => setStep(0)}><ArrowLeft size={17} />上一步</button><button className="setup-button primary">继续 <ArrowRight size={17} /></button></div>
          </form>}

          {step === 2 && <>
            <section className="setup-check-group"><h3><span>01</span> 模型连接</h3>{test ? <ul className="setup-checks">{test.results.map((result, index) => <li key={index}><span className={result.success ? 'setup-pass' : 'setup-fail'}>{result.success ? <CheckCircle2 size={18} /> : '!'}</span><div><strong>{result.model}</strong><p>{result.message}</p></div></li>)}</ul> : <p>{saved ? '已保存的配置通过了连接测试。' : '检查文本生成、向量、重排，以及所选能力的模型连接。'}</p>}
              <button className="setup-button" disabled={locked || !authorized} onClick={runTest}>{test || saved ? '重新测试连接' : '开始连接测试'}</button>
            </section>
            <section className="setup-check-group"><h3><span>02</span> 存储与本地模型准备</h3><p>先检查存储并准备检索集合，再下载所需模型并验证推理。已有缓存会保留。</p>
              {status.progress.stage === 'storage' && status.progress.state === 'running' && <p className="setup-live" role="status"><Loader2 size={17} className="setup-spin" aria-hidden />{status.progress.message || '正在检查存储并准备检索集合…'}</p>}
              {status.progress.state === 'error' && status.progress.error_code === 'STORAGE_UNAVAILABLE' && status.progress.message && <div className="setup-error" role="alert"><strong>{status.progress.message}</strong>{status.progress.hint && <p>{status.progress.hint}</p>}</div>}
              {status.progress.stage !== 'storage' && status.progress.total > 0 && <><div className="setup-model-overview"><span>本地模型</span><span>{status.progress.completed} / {status.progress.total} 已就绪</span></div><ul className="setup-checks setup-models">{Object.entries(status.progress.models).map(([model, value]) => <ModelProgress key={model} name={model} value={value} />)}</ul></>}
              <button className="setup-button primary" disabled={locked || !authorized || (!saved && !test?.success)} onClick={prepare}>{preparing ? '正在准备…' : status.progress.state === 'interrupted' || status.progress.state === 'error' ? '继续准备' : '保存并准备'}<ArrowRight size={17} /></button>
            </section>
            <div className="setup-actions"><button className="setup-button" disabled={locked} onClick={() => setStep(1)}><ArrowLeft size={17} />上一步</button>{status.ready && <button className="setup-button primary" onClick={() => setStep(3)}>完成 <ArrowRight size={17} /></button>}</div>
          </>}

          {step === 3 && <><div className="setup-ready"><CheckCircle2 size={24} /><div><strong>连接已验证，模型已准备</strong><p>以后运行 <code>tessmora start</code> 即可重新启动。</p></div></div><SetupSample /><div className="setup-actions"><button className="setup-button" onClick={() => setStep(0)}>调整配置</button><Link className="setup-button primary" to="/">进入工作台 <ArrowRight size={17} /></Link></div></>}
          {busy && <p className="setup-live" role="status"><Loader2 size={17} className="setup-spin" />{busy}</p>}
          {error && <p className="setup-error" role="alert">{error}</p>}
        </>}
        <footer className="setup-footer"><FileText size={14} /><span>你的文档保存在所选安装目录。模型调用会将所需内容发送给配置的服务商。</span></footer>
      </section>
    </main>
  </div>
}
