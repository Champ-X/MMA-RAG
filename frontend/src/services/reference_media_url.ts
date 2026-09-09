import { chatApi } from './api_client'

const MIN_FRESH_TTL_MS = 60_000

type CachedUrl = {
  url: string
  expiresAt: number
}

const videoUrlCache = new Map<string, CachedUrl>()
const pendingVideoUrls = new Map<string, Promise<string>>()

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
  if (!url) return false
  const expiresAt = getPresignedExpiry(url)
  // 非预签名地址无法从查询参数判断有效期，交给浏览器正常加载。
  return expiresAt == null || expiresAt > Date.now() + minTtlMs
}

export async function getFreshReferenceVideoUrl({
  kbId,
  filePath,
  currentUrl,
  force = false,
}: {
  kbId: string
  filePath: string
  currentUrl?: string | null
  force?: boolean
}): Promise<string> {
  if (!force && isReferenceMediaUrlFresh(currentUrl)) return currentUrl!

  const key = `${kbId.trim()}::${filePath.trim()}`
  const cached = videoUrlCache.get(key)
  if (!force && cached && cached.expiresAt > Date.now() + MIN_FRESH_TTL_MS) {
    return cached.url
  }

  const pending = pendingVideoUrls.get(key)
  if (pending) return pending

  const request = chatApi
    .getReferenceVideoUrl({ kb_id: kbId, file_path: filePath })
    .then((response) => {
      if (!response?.video_url) throw new Error('视频播放地址为空')
      const expiresAt = getPresignedExpiry(response.video_url) ?? Date.now() + 5 * 60_000
      videoUrlCache.set(key, { url: response.video_url, expiresAt })
      return response.video_url
    })
    .finally(() => {
      pendingVideoUrls.delete(key)
    })

  pendingVideoUrls.set(key, request)
  return request
}
