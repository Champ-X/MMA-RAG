import { describe, expect, it } from 'vitest'

describe('conversation history query recovery contract', () => {
  it('does not present empty conversation states when the durable history query failed', () => {
    const files = import.meta.glob<string>(
      ['../features/runs/ConversationHistoryPage.tsx', '../components/nexus/queryErrorNoticeViewModel.ts'],
      {
        eager: true,
        import: 'default',
        query: '?raw',
      },
    )
    const page = files['../features/runs/ConversationHistoryPage.tsx']
    const viewModel = files['../components/nexus/queryErrorNoticeViewModel.ts']

    expect(page).toContain("label: 'Conversation history', required: true")
    expect(page).toContain('<QueryErrorNotice model={queryErrorNotice} onRetry={retryConversationHistory} />')
    expect(page).toContain("queryErrorNotice.tone === 'blocking'")
    expect(page).toContain('void history.refetch()')
    expect(page).not.toContain('Conversation history could not be loaded. {history.error.message}')
    expect(page.indexOf("queryErrorNotice.tone === 'blocking'")).toBeLessThan(page.indexOf('Start your first conversation'))
    expect(page.indexOf("queryErrorNotice.tone === 'blocking'")).toBeLessThan(page.indexOf('No conversation matches'))
    expect(page.indexOf("queryErrorNotice.tone === 'blocking'")).toBeLessThan(page.indexOf('No archived conversations'))
    expect(viewModel).toContain('hasRequiredMissingData')
  })
})
