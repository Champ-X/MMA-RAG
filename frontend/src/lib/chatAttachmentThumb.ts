/**
 * 将用户选择的图片压成小幅 JPEG data URL，便于写入 localStorage（blob: 预览 URL 无法跨刷新存活）。
 */
export async function imageFileToPersistedThumb(
  file: File,
  options?: { maxEdge?: number; quality?: number }
): Promise<string | undefined> {
  if (!file.type.startsWith('image/')) return undefined
  const maxEdge = options?.maxEdge ?? 384
  const quality = options?.quality ?? 0.72
  try {
    const bmp = await createImageBitmap(file)
    const w = bmp.width
    const h = bmp.height
    const scale = Math.min(1, maxEdge / Math.max(w, h))
    const tw = Math.max(1, Math.round(w * scale))
    const th = Math.max(1, Math.round(h * scale))
    const canvas = document.createElement('canvas')
    canvas.width = tw
    canvas.height = th
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      bmp.close?.()
      return undefined
    }
    ctx.drawImage(bmp, 0, 0, tw, th)
    bmp.close?.()
    const dataUrl = canvas.toDataURL('image/jpeg', quality)
    return dataUrl.length > 12 ? dataUrl : undefined
  } catch {
    return undefined
  }
}
