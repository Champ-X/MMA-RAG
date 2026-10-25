/** Bound the extra request used for a waveform; playback itself has no such limit. */
export const MAX_WAVEFORM_BYTES = 16 * 1024 * 1024
export const WAVEFORM_BINS = 96

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError')
}

/** Check both advertised and actual sizes, including chunked or misleading responses. */
export async function readWaveformAudio(
  response: Response,
  signal: AbortSignal,
  maxBytes = MAX_WAVEFORM_BYTES,
): Promise<ArrayBuffer> {
  throwIfAborted(signal)
  const declaredSize = Number(response.headers.get('content-length'))
  if (Number.isFinite(declaredSize) && declaredSize > maxBytes) {
    await response.body?.cancel()
    throw new Error('Audio is too large for a waveform preview')
  }
  // Streaming is required so an absent Content-Length cannot bypass the limit.
  if (!response.body) throw new Error('Audio response has no readable body')
  const reader = response.body.getReader()
  const cancel = () => { void reader.cancel(signal.reason).catch(() => {}) }
  signal.addEventListener('abort', cancel, { once: true })
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      throwIfAborted(signal)
      const { done, value } = await reader.read()
      throwIfAborted(signal)
      if (done) break
      size += value.byteLength
      if (size > maxBytes) throw new Error('Audio is too large for a waveform preview')
      chunks.push(value)
    }
    const bytes = new Uint8Array(size)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.byteLength
    }
    return bytes.buffer
  } catch (error) {
    await reader.cancel().catch(() => {})
    throw error
  } finally {
    signal.removeEventListener('abort', cancel)
    reader.releaseLock()
  }
}

type WaveformBuffer = Pick<AudioBuffer, 'length' | 'numberOfChannels' | 'getChannelData'>

/**
 * Real amplitude in chronological bins, normalized across all channels.
 * At most 256 samples per bin/channel keeps long recordings cheap to summarize.
 */
export function extractWaveformPeaks(buffer: WaveformBuffer, bins = WAVEFORM_BINS): number[] {
  const peaks = Array<number>(bins).fill(0)
  if (!buffer.length || !buffer.numberOfChannels) return peaks
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const samples = buffer.getChannelData(channel)
    for (let bin = 0; bin < bins; bin++) {
      const start = Math.floor(bin * buffer.length / bins)
      const end = Math.floor((bin + 1) * buffer.length / bins)
      const step = Math.max(1, Math.ceil((end - start) / 256))
      let peak = peaks[bin]
      for (let sample = start; sample < end; sample += step) {
        const amplitude = Math.abs(samples[sample])
        if (Number.isFinite(amplitude) && amplitude > peak) peak = amplitude
      }
      peaks[bin] = peak
    }
  }
  const maximum = Math.max(...peaks)
  return maximum > 0 ? peaks.map(peak => peak / maximum) : peaks
}
