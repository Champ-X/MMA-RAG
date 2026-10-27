import { isAudioType, isVideoType, type KnowledgeFileView } from './KnowledgeListHelpers'

export type KnowledgeFileKind = 'documents' | 'images' | 'audio' | 'video'
export type KnowledgeFileFilter = 'all' | KnowledgeFileKind

export const KNOWLEDGE_FILE_FILTERS = [
  { key: 'all', label: '全部' },
  { key: 'documents', label: '文档' },
  { key: 'images', label: '图片' },
  { key: 'audio', label: '音频' },
  { key: 'video', label: '视频' },
] as const

const IMAGE_TYPES = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'svg', 'bmp', 'tiff', 'tif', 'heic', 'heif'])

export function getKnowledgeFileKind(file: Pick<KnowledgeFileView, 'name' | 'type'>): KnowledgeFileKind {
  const type = String(file.type || '').toLowerCase().split(';')[0].trim()
  const extension = file.name.split('.').pop()?.toLowerCase() || ''
  if (isAudioType(type) || isAudioType(extension)) return 'audio'
  if (type.startsWith('video/') || isVideoType(type) || isVideoType(extension)) return 'video'
  if (type.startsWith('image/') || IMAGE_TYPES.has(type) || IMAGE_TYPES.has(extension)) return 'images'
  return 'documents'
}
