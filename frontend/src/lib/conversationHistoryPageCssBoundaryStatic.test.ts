import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('Conversation history page CSS loading boundary', () => {
  it('keeps durable conversation ledger styles with the lazy ConversationHistory route', () => {
    const files = import.meta.glob<string>(
      [
        '../app/router.tsx',
        '../features/runs/ConversationHistoryPage.tsx',
      ],
      {
        eager: true,
        import: 'default',
        query: '?raw',
      },
    )
    const router = files['../app/router.tsx']
    const page = files['../features/runs/ConversationHistoryPage.tsx']
    const pageCss = readFileSync(new URL('../features/runs/ConversationHistoryPage.css', import.meta.url), 'utf8')
    const entryCss = readFileSync(new URL('../index.css', import.meta.url), 'utf8')

    expect(router).toContain("const ConversationHistoryPage = lazy(() => import('@/features/runs/ConversationHistoryPage'))")
    expect(page).toContain("import './ConversationHistoryPage.css'")
    expect(page).toContain("import { moveRadioGroupValue, resolveRadioGroupDirection } from '@/lib/radioGroupKeyboard'")
    expect(page).toContain('className="history-view-switch" role="radiogroup" aria-label="Conversation status"')
    expect(page).toContain('role="radio"')
    expect(page).toContain('aria-checked={!showArchived}')
    expect(page).toContain('aria-checked={showArchived}')
    expect(pageCss).toContain('.history-toolbar')
    expect(pageCss).toContain('.history-search')
    expect(pageCss).toContain('.history-view-switch')
    expect(pageCss).toContain('.conversation-ledger')
    expect(pageCss).toContain('.conversation-open')
    expect(pageCss).toContain('.conversation-glyph')
    expect(pageCss).toContain('.conversation-rename')
    expect(pageCss).toContain('.conversation-actions')
    expect(pageCss).toContain('.history-load-more')
    expect(pageCss).toContain('html[data-theme="dark"] .conversation-ledger article.is-pinned')
    expect(pageCss).toContain('@media (max-width: 1180px)')
    expect(pageCss).toContain('@media (max-width: 820px)')
    expect(entryCss).not.toMatch(/^\.history-/m)
    expect(entryCss).not.toContain('.history-search kbd')
    expect(entryCss).not.toContain('.conversation-ledger')
    expect(entryCss).not.toContain('.conversation-open')
    expect(entryCss).not.toContain('.conversation-glyph')
    expect(entryCss).not.toContain('.conversation-rename')
    expect(entryCss).not.toContain('.conversation-actions')
    expect(entryCss).not.toContain('.is-renaming')
    expect(entryCss).not.toContain('html[data-theme="dark"] .conversation-ledger')
    expect(entryCss).not.toContain('html[data-theme="dark"] .history-')
    expect(entryCss).not.toContain('conversation-workspace')
  })
})
