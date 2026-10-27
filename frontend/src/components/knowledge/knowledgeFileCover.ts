type FileIdentity = { id?: string; name: string; type: string }

export type FileMediaKind = 'document' | 'image' | 'audio' | 'video'
export type FileCoverKind = 'pdf' | 'word' | 'slides' | 'spreadsheet' | 'csv' | 'markdown' | 'text' | 'audio'

const COVER_ROOT = '/knowledge/file-covers-v1'
const IMAGE_TYPES = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'tiff', 'tif', 'avif', 'svg', 'bmp', 'heic', 'heif'])
const AUDIO_TYPES = new Set(['mp3', 'wav', 'm4a', 'flac', 'aac', 'ogg', 'wma', 'opus'])
const VIDEO_TYPES = new Set(['mp4', 'avi', 'mov', 'mkv', 'webm', 'flv', 'wmv', 'm4v'])
const DOCUMENT_COVERS: Record<string, Exclude<FileCoverKind, 'audio'>> = {
  pdf: 'pdf', doc: 'word', docx: 'word', pptx: 'slides', txt: 'text', md: 'markdown',
  xlsx: 'spreadsheet', xls: 'spreadsheet', csv: 'csv',
}
const MIME_EXTENSIONS: Record<string, string> = {
  'application/pdf': 'pdf',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'text/plain': 'txt', 'text/markdown': 'md', 'text/x-markdown': 'md', 'text/csv': 'csv',
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp',
  'image/tiff': 'tiff', 'image/svg+xml': 'svg', 'image/avif': 'avif',
  'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/wav': 'wav', 'audio/x-wav': 'wav',
  'audio/wave': 'wav', 'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a',
  'audio/flac': 'flac', 'audio/x-flac': 'flac', 'audio/aac': 'aac',
  'audio/ogg': 'ogg', 'audio/opus': 'opus', 'audio/x-ms-wma': 'wma',
  'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm',
  'video/x-msvideo': 'avi', 'video/x-matroska': 'mkv', 'video/x-flv': 'flv',
  'video/x-ms-wmv': 'wmv', 'video/x-m4v': 'm4v',
}

function normalizedType(type: string) {
  return String(type || '').split(';')[0].trim().toLowerCase().replace(/^\./, '')
}

/** The backend's explicit format wins; filenames fill in missing or generic MIME metadata. */
export function getFileExtension(file: Pick<FileIdentity, 'name' | 'type'>): string {
  const type = normalizedType(file.type)
  const filenameExtension = file.name.trim().match(/\.([a-z\d]+)$/i)?.[1].toLowerCase()
  // Browsers report many text formats as plain text; preserve their real extension.
  if (type === 'text/plain' && filenameExtension) return filenameExtension
  if (MIME_EXTENSIONS[type]) return MIME_EXTENSIONS[type]
  if (DOCUMENT_COVERS[type] || IMAGE_TYPES.has(type) || AUDIO_TYPES.has(type) || VIDEO_TYPES.has(type)) return type
  return filenameExtension || (!type.includes('/') ? type : '') || 'file'
}

export function getFileMediaKind(file: Pick<FileIdentity, 'name' | 'type'>): FileMediaKind {
  const type = normalizedType(file.type)
  // A real image named "report.pdf" still uses its own image preview.
  if (type.startsWith('image/')) return 'image'
  if (type.startsWith('audio/')) return 'audio'
  if (type.startsWith('video/')) return 'video'
  const extension = getFileExtension(file)
  if (IMAGE_TYPES.has(extension)) return 'image'
  if (AUDIO_TYPES.has(extension)) return 'audio'
  if (VIDEO_TYPES.has(extension)) return 'video'
  return 'document'
}

const AUDIO_COVERS = ['audio-vinyl', 'audio-headphones', 'audio-cassette', 'audio-waveform'] as const

function stableAudioIndex(identity: string): number {
  let hash = 2166136261
  for (let i = 0; i < identity.length; i++) hash = Math.imul(hash ^ identity.charCodeAt(i), 16777619)
  return (hash >>> 0) % AUDIO_COVERS.length
}

/** Artwork identifies the format, never a claimed preview or inferred music genre. */
export function getKnowledgeFileCover(file: FileIdentity): { src: string; kind: FileCoverKind; extension: string } | undefined {
  const mediaKind = getFileMediaKind(file)
  if (mediaKind === 'image' || mediaKind === 'video') return undefined
  const extension = getFileExtension(file)
  const kind = mediaKind === 'audio' ? 'audio' : DOCUMENT_COVERS[extension]
  if (!kind) return undefined
  const asset = kind === 'audio' ? AUDIO_COVERS[stableAudioIndex(file.id || file.name)]
    : extension === 'doc' ? 'word-doc'
      : extension === 'xls' ? 'spreadsheet-xls' : kind
  return { src: `${COVER_ROOT}/${asset}.webp`, kind, extension: extension.toUpperCase() }
}
