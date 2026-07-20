import { afterEach, describe, expect, it, vi } from 'vitest'

import { nexusApi } from './nexus'

describe('nexus request body handling', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('reads an upload error response body exactly once', async () => {
    const text = vi
      .fn()
      .mockResolvedValueOnce(
        JSON.stringify({
          error: {
            code: 'INGESTION_REJECTED',
            message: 'Unsupported media',
            retryable: false,
          },
        }),
      )
      .mockRejectedValue(new TypeError('body stream already read'))
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 422,
        statusText: 'Unprocessable Entity',
        text,
      }),
    )

    await expect(
      nexusApi.uploadSource('space-1', new File(['payload'], 'sample.txt')),
    ).rejects.toMatchObject({
      status: 422,
      code: 'INGESTION_REJECTED',
      message: 'Unsupported media',
    })
    expect(text).toHaveBeenCalledTimes(1)
  })

  it('serializes an explicit run history limit', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: vi.fn().mockResolvedValue(JSON.stringify({ items: [], page: { next_cursor: null } })),
    })
    vi.stubGlobal('fetch', fetchMock)

    await nexusApi.listRuns(200)

    expect(fetchMock).toHaveBeenCalledWith('/api/v1/runs?limit=200', expect.any(Object))
  })
})
