import { Radio } from 'lucide-react'

export function RunWorkspaceSkeleton() {
  return (
    <div className="run-workspace run-workspace-skeleton" aria-busy="true">
      <header className="run-topbar">
        <div className="skeleton-back" />
        <div>
          <p className="eyebrow">Conversation · recovering</p>
          <h1>Recovering conversation state</h1>
        </div>
        <div className="run-control-stack">
          <div className="run-controls">
            <span className="stream-state stream-connecting"><Radio size={13} />connecting</span>
          </div>
        </div>
      </header>
      <div className="run-columns">
        <aside className="run-plan-column">
          <div className="column-head"><span>Conversation & process</span><code>...</code></div>
          <div className="skeleton-panel tall" />
          <div className="skeleton-panel" />
        </aside>
        <main className="run-result-column conversation-column">
          <div className="column-head"><span>Evidence conversation</span><span>loading</span></div>
          <div className="assistant-message skeleton-message" role="status">
            <header><span className="assistant-orb" /><span><strong>Nexus</strong><small>retrieving the saved turn</small></span></header>
            <div className="skeleton-line wide" />
            <div className="skeleton-line" />
            <div className="skeleton-line short" />
          </div>
        </main>
      </div>
    </div>
  )
}
