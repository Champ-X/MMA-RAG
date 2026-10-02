import { chatApi } from './api_client'

const MIN_FRESH_TTL_MS = 60_000

type CachedUrl = {
  url: string
  expiresAt: number
}

export type ReferenceMediaType = 'image' | 'audio' | 'video'

type ReferenceMediaUrlOptions = {
  type: ReferenceMediaType
  kbId: string
  filePath: string
  currentUrl?: string | null
  force?: boolean
}

const mediaUrlCache = new Map<string, CachedUrl>()
const pendingMediaUrls = new Map<string, Promise<string>>()

function getPresignedExpiry(url: string): number | null {
  try {
    const parsed = new URL(url)
    const signedAt = parsed.searchParams.get('X-Amz-Date')
    const expiresSeconds = Number(parsed.searchParams.get('X-Amz-Expires'))
    const match = signedAt?.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/)
    if (!match || !Number.isFinite(expiresSeconds)) return null

    const [, year, month, day, hour, minute, second] = match
    return Date.UTC(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute),
      Number(second),
    ) + expiresSeconds * 1000
  } catch {
    return null
  }
}

export function isReferenceMediaUrlFresh(url?: string | null, minTtlMs = MIN_FRESH_TTL_MS): boolean {
  if (!url?.trim()) return false
  const expiresAt = getPresignedExpiry(url)
  // 非预签名地址无法从查询参数判断有效期，交给浏览器正常加载。
  return expiresAt == null || expiresAt > Date.now() + minTtlMs
}

/** Resolve an original media URL without changing or reprocessing the source. */
export async function getFreshReferenceMediaUrl({
  type,
  kbId,
  filePath,
  currentUrl,
  force = false,
}: ReferenceMediaUrlOptions): Promise<string> {
  if (!force && isReferenceMediaUrlFresh(currentUrl)) return currentUrl!

  const params = { kb_id: kbId.trim(), file_path: filePath.trim() }
  if (!params.kb_id || !params.file_path) throw new Error('缺少知识库或文件路径，无法刷新媒体地址')
  const key = JSON.stringify([type, params.kb_id, params.file_path])
  const cached = mediaUrlCache.get(key)
  if (!force && cached && cached.expiresAt > Date.now() + MIN_FRESH_TTL_MS) {
    return cached.url
  }

  const pending = pendingMediaUrls.get(key)
  if (pending) return pending

  const resolveUrl = async () => {
    if (type === 'image') return (await chatApi.getReferenceImageUrl(params))?.img_url
    if (type === 'audio') return (await chatApi.getReferenceAudioUrl(params))?.audio_url
    return (await chatApi.getReferenceVideoUrl(params))?.video_url
  }
  const request = resolveUrl()
    .then((url) => {
      if (!url?.trim()) throw new Error('媒体播放或预览地址为空')
      const expiresAt = getPresignedExpiry(url) ?? Date.now() + 5 * 60_000
      mediaUrlCache.set(key, { url, expiresAt })
      return url
    })
    .finally(() => {
      pendingMediaUrls.delete(key)
    })

  pendingMediaUrls.set(key, request)
  return request
}

/** Compatibility wrapper for existing citation video players. */
export function getFreshReferenceVideoUrl(options: Omit<ReferenceMediaUrlOptions, 'type'>): Promise<string> {
  return getFreshReferenceMediaUrl({ ...options, type: 'video' })
}
