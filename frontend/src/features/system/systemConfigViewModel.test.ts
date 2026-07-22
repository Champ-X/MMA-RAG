import { describe, expect, it } from 'vitest'
import { buildSystemConfigViewModel } from './systemConfigViewModel'

describe('buildSystemConfigViewModel', () => {
  it('keeps folder roots explicit while explaining that secrets are state-only', () => {
    const vm = buildSystemConfigViewModel({
      agent_runtime: 'langgraph',
      connectors: {
        allowed_folder_roots: ['/imports', '/imports/project'],
        google_images_configured: true,
        internet_archive_configured: true,
        news_search_configured: false,
        pixabay_configured: false,
      },
      environment: 'production',
      external_tools_enabled: false,
      feature_models_enabled: true,
      media_enrichment_enabled: true,
      research_runtime_enabled: true,
      sandbox: { status: 'ready' },
      sandbox_backend: 'unix',
      secrets: {
        embedding_configured: true,
        feishu_configured: false,
        generation_configured: true,
        mineru_configured: true,
        reranker_configured: true,
      },
    })

    const serialized = JSON.stringify(vm)

    expect(vm.overviewLabel).toBe('Safe configuration loaded')
    expect(vm.overviewDetail).toContain('2 import roots visible')
    expect(vm.notice).toContain('Folder roots are shown intentionally')
    expect(serialized).toContain('/imports/project')
    expect(serialized.toLowerCase()).not.toContain('redacted')
  })

  it('formats operator limits into readable labels', () => {
    const vm = buildSystemConfigViewModel({
      connector_max_download_bytes: 268435456,
      max_upload_bytes: 1073741824,
      worker_lease_seconds: 120,
    })

    const limits = vm.sections.find((section) => section.title === 'Throughput Boundaries')

    expect(limits?.items.map((item) => item.value)).toEqual([
      '120s lease',
      '1 GB',
      '256 MB',
    ])
  })

  it('has a pending state that does not invent hidden paths', () => {
    const vm = buildSystemConfigViewModel(null)

    expect(vm.overviewLabel).toBe('Configuration pending')
    expect(vm.overviewDetail).toBe('Configuration summary is waiting for the API response; no folder roots or secret states are inferred locally.')
    expect(vm.sections.find((section) => section.title === 'Import Paths And Providers')?.items[0]).toMatchObject({
      label: 'Allowed folder roots',
      value: 'No folder roots configured',
    })
  })

  it('does not use redaction language in operator-facing summaries', () => {
    const serialized = JSON.stringify(buildSystemConfigViewModel(null)).toLowerCase()

    expect(serialized).not.toContain('raw diagnostic')
    expect(serialized).not.toContain('redacted')
    expect(serialized).not.toContain('hidden')
  })
})
