import { useId, useState } from 'react'
import { KeyRound } from 'lucide-react'
import { WorkflowDialog } from '@/components/ui/WorkflowDialog'
import { PiApiError } from '@/services/piAgent'

export function PiWorkspaceDialog({ onClose, connect }: { onClose: () => void; connect: (token: string) => Promise<void> }) {
  const id = useId()
  const [token, setToken] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  return <WorkflowDialog open onOpenChange={open => { if (!open) onClose() }} title="连接工作区"
    description="连接成功后即可选择模型并使用纯 Agent。" icon={<KeyRound size={25} />} size="sm" busy={busy}
    onSubmit={async event => {
      event.preventDefault()
      if (busy) return
      setBusy(true); setError('')
      try { await connect(token); setToken(''); onClose() }
      catch (cause) { setError(cause instanceof PiApiError && cause.status === 401
        ? '凭证无效或已更换，请从当前实例重新获取连接链接。'
        : cause instanceof Error ? cause.message : '连接失败，请重试。') }
      finally { setBusy(false) }
    }} footer={<><button className="workflow-button" type="button" disabled={busy} onClick={onClose}>取消</button>
      <button className="workflow-button-primary" type="submit" disabled={busy || !token.trim()}>{busy ? '正在连接…' : '连接'}</button></>}>
    <div className="pi-workspace-connection">
      <p>在运行 Tessmora 的终端执行以下命令，复制输出的完整链接到这里，也可以直接在浏览器打开链接。</p>
      <code>tessmora open --print-url</code>
      <details><summary>从源码运行 / 提示找不到命令</summary>
        <p>在仓库目录执行：</p><code>node packages/cli/bin/tessmora.js open --print-url</code>
      </details>
      <p className="pi-workspace-hint">如使用了自定义实例，沿用原来的 --home / --instance。远程部署请向管理员获取工作区访问凭证。</p>
      <label htmlFor={id}>连接链接或访问凭证</label>
      <input id={id} type="password" data-autofocus autoComplete="off" spellCheck={false}
        value={token} disabled={busy} aria-invalid={Boolean(error)} aria-describedby={`${id}-hint${error ? ` ${id}-error` : ''}`}
        onChange={event => { setToken(event.target.value); setError('') }} />
      <p id={`${id}-hint`} className="pi-workspace-hint">这是此工作区的访问凭证，不是模型服务商的 API Key。请勿分享连接链接。</p>
      {error && <p id={`${id}-error`} className="pi-workspace-error" role="alert">{error}</p>}
    </div>
  </WorkflowDialog>
}
