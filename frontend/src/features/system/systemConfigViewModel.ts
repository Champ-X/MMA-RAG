export type SystemConfigTone = 'muted' | 'ready' | 'warning'

export type SystemConfigEntry = {
  code?: boolean
  detail?: string
  label: string
  tone: SystemConfigTone
  value: string
}

export type SystemConfigSection = {
  description: string
  eyebrow: string
  items: SystemConfigEntry[]
  title: string
}

export type SystemConfigViewModel = {
  diagnostic: Record<string, unknown>
  notice: string
  overviewDetail: string
  overviewLabel: string
  sections: SystemConfigSection[]
}

const truthyLabel = (value: unknown, enabled = 'On', disabled = 'Off') =>
  value === true ? enabled : value === false ? disabled : 'Unknown'

const truthyTone = (value: unknown): SystemConfigTone =>
  value === true ? 'ready' : value === false ? 'muted' : 'warning'

const configuredLabel = (value: unknown) =>
  value === true ? 'Configured' : value === false ? 'Missing' : 'Unknown'

const configuredTone = (value: unknown): SystemConfigTone =>
  value === true ? 'ready' : value === false ? 'warning' : 'muted'

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function textValue(value: unknown, fallback = 'Unknown') {
  return typeof value === 'string' && value.trim() ? value : fallback
}

function numberValue(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function bytesLabel(value: unknown) {
  const bytes = numberValue(value)
  if (bytes == null) return 'Unknown'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let scaled = bytes
  let unitIndex = 0
  while (scaled >= 1024 && unitIndex < units.length - 1) {
    scaled /= 1024
    unitIndex += 1
  }
  const precision = scaled >= 10 || unitIndex === 0 ? 0 : 1
  const label = scaled.toFixed(precision).replace(/\.0$/, '')
  return `${label} ${units[unitIndex]}`
}

function secondsLabel(value: unknown) {
  const seconds = numberValue(value)
  return seconds == null ? 'Unknown' : `${seconds}s lease`
}

function folderRootsLabel(value: unknown) {
  if (!Array.isArray(value)) return 'No folder roots configured'
  const roots = value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
  return roots.length ? roots.join(', ') : 'No folder roots configured'
}

export function buildSystemConfigViewModel(config?: Record<string, unknown> | null): SystemConfigViewModel {
  const diagnostic = config ?? {}
  const connectors = objectValue(diagnostic.connectors)
  const sandbox = objectValue(diagnostic.sandbox)
  const secrets = objectValue(diagnostic.secrets)
  const rootCount = Array.isArray(connectors.allowed_folder_roots)
    ? connectors.allowed_folder_roots.filter((item) => typeof item === 'string' && item.trim()).length
    : 0
  const secretValues = Object.values(secrets)
  const configuredSecrets = secretValues.filter((value) => value === true).length
  const totalSecrets = secretValues.length

  return {
    diagnostic,
    notice: 'Secret values never leave the backend. Folder roots are shown intentionally because they are operator-visible allowlist paths used by folder import, not server file contents.',
    overviewDetail: config
      ? `${rootCount} import root${rootCount === 1 ? '' : 's'} visible; ${configuredSecrets}/${totalSecrets || 0} integration secrets configured.`
      : 'Configuration summary is waiting for the API response; no folder roots or secret states are inferred locally.',
    overviewLabel: config ? 'Safe configuration loaded' : 'Configuration pending',
    sections: [
      {
        description: 'Execution mode and high-impact kill switches that affect Run behavior.',
        eyebrow: 'Runtime',
        title: 'Policy Surface',
        items: [
          { label: 'Environment', tone: 'muted', value: textValue(diagnostic.environment) },
          { label: 'Agent runtime', tone: 'muted', value: textValue(diagnostic.agent_runtime) },
          {
            detail: `Transport: ${textValue(diagnostic.sandbox_backend)}`,
            label: 'Sandbox',
            tone: textValue(sandbox.status, '') === 'ready' ? 'ready' : 'warning',
            value: textValue(sandbox.status),
          },
          { label: 'Research runtime', tone: truthyTone(diagnostic.research_runtime_enabled), value: truthyLabel(diagnostic.research_runtime_enabled) },
          { label: 'External tools', tone: truthyTone(diagnostic.external_tools_enabled), value: truthyLabel(diagnostic.external_tools_enabled) },
        ],
      },
      {
        description: 'Feature gates that change indexing, enrichment, and model-backed behavior.',
        eyebrow: 'Feature Flags',
        title: 'Capability Gates',
        items: [
          { label: 'Knowledge compilation', tone: truthyTone(diagnostic.knowledge_compilation_enabled), value: truthyLabel(diagnostic.knowledge_compilation_enabled) },
          { label: 'Background enrichment', tone: truthyTone(diagnostic.background_enrichment_enabled), value: truthyLabel(diagnostic.background_enrichment_enabled) },
          { label: 'Page multivector', tone: truthyTone(diagnostic.page_multivector_enabled), value: truthyLabel(diagnostic.page_multivector_enabled) },
          { label: 'Model features', tone: truthyTone(diagnostic.feature_models_enabled), value: truthyLabel(diagnostic.feature_models_enabled) },
          { label: 'Media enrichment', tone: truthyTone(diagnostic.media_enrichment_enabled), value: truthyLabel(diagnostic.media_enrichment_enabled) },
        ],
      },
      {
        description: 'Operator-facing limits that explain upload and connector behavior.',
        eyebrow: 'Limits',
        title: 'Throughput Boundaries',
        items: [
          { label: 'Worker lease', tone: 'muted', value: secondsLabel(diagnostic.worker_lease_seconds) },
          { label: 'Upload cap', tone: 'muted', value: bytesLabel(diagnostic.max_upload_bytes) },
          { label: 'Connector download cap', tone: 'muted', value: bytesLabel(diagnostic.connector_max_download_bytes) },
        ],
      },
      {
        description: 'Connector readiness without exposing credentials or unrelated host inventory.',
        eyebrow: 'Connectors',
        title: 'Import Paths And Providers',
        items: [
          {
            code: true,
            detail: 'Visible allowlist roots are required so operators know which server folders can be imported.',
            label: 'Allowed folder roots',
            tone: rootCount > 0 ? 'ready' : 'warning',
            value: folderRootsLabel(connectors.allowed_folder_roots),
          },
          { label: 'News search', tone: configuredTone(connectors.news_search_configured), value: configuredLabel(connectors.news_search_configured) },
          { label: 'Google Images', tone: configuredTone(connectors.google_images_configured), value: configuredLabel(connectors.google_images_configured) },
          { label: 'Pixabay', tone: configuredTone(connectors.pixabay_configured), value: configuredLabel(connectors.pixabay_configured) },
          { label: 'Internet Archive', tone: configuredTone(connectors.internet_archive_configured), value: configuredLabel(connectors.internet_archive_configured) },
        ],
      },
      {
        description: 'Only configured/missing states are returned; secret material is not part of this contract.',
        eyebrow: 'Secrets',
        title: 'Integration Readiness',
        items: [
          { label: 'MinerU', tone: configuredTone(secrets.mineru_configured), value: configuredLabel(secrets.mineru_configured) },
          { label: 'Generation', tone: configuredTone(secrets.generation_configured), value: configuredLabel(secrets.generation_configured) },
          { label: 'Embedding', tone: configuredTone(secrets.embedding_configured), value: configuredLabel(secrets.embedding_configured) },
          { label: 'Reranker', tone: configuredTone(secrets.reranker_configured), value: configuredLabel(secrets.reranker_configured) },
          { label: 'Feishu', tone: configuredTone(secrets.feishu_configured), value: configuredLabel(secrets.feishu_configured) },
        ],
      },
    ],
  }
}
