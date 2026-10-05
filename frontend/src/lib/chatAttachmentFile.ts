export function formatAttachmentSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10240 ? 1 : 0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function chatFileKind(file: Pick<File, 'name' | 'type'>): 'image' | 'audio' | 'video' | null {
  const type = file.type.toLowerCase().split(';')[0]
  if (['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(type)) return 'image'
  if (['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav', 'audio/wave', 'audio/flac', 'audio/x-flac', 'audio/ogg', 'audio/webm', 'audio/mp4', 'audio/m4a', 'audio/x-m4a'].includes(type)) return 'audio'
  if (['video/mp4', 'video/webm', 'video/quicktime'].includes(type)) return 'video'
  if (!type || type === 'application/octet-stream') {
    if (/\.(jpe?g|png|gif|webp)$/i.test(file.name)) return 'image'
    if (/\.(mp3|wav|flac|ogg|m4a)$/i.test(file.name)) return 'audio'
    if (/\.(mp4|webm|mov)$/i.test(file.name)) return 'video'
  }
  return null
}
