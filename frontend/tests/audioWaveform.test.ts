import assert from 'node:assert/strict'
import { test } from 'node:test'
import { extractWaveformPeaks, MAX_WAVEFORM_BYTES, readWaveformAudio, WAVEFORM_BINS } from '../src/lib/audioWaveform'

test('waveform bins retain chronological amplitude and include both stereo channels', () => {
  const channels = [new Float32Array([0, 0, 1, -1, 0.5, -0.5, 0, 0]), new Float32Array([0.25, 0, 0, 0, 0, 0, -0.75, 0])]
  assert.deepEqual(extractWaveformPeaks({ length: 8, numberOfChannels: 2, getChannelData: channel => channels[channel] }, 4), [0.25, 1, 0.5, 0.75])
})

test('silence and very short media produce finite normalized bins without invented amplitude', () => {
  const silence = new Float32Array(200)
  assert.deepEqual(extractWaveformPeaks({ length: silence.length, numberOfChannels: 1, getChannelData: () => silence }), Array(WAVEFORM_BINS).fill(0))
  const short = new Float32Array([NaN, 0.25, -0.5])
  const peaks = extractWaveformPeaks({ length: short.length, numberOfChannels: 1, getChannelData: () => short })
  assert.equal(peaks.length, 96)
  assert.equal(Math.max(...peaks), 1)
  assert.ok(peaks.every(peak => Number.isFinite(peak) && peak >= 0 && peak <= 1))
})

test('bounded response reading accepts exact limits and preserves bytes', async () => {
  assert.equal(MAX_WAVEFORM_BYTES, 16 * 1024 * 1024)
  const result = await readWaveformAudio(new Response(new Uint8Array([1, 2, 3, 4])), new AbortController().signal, 4)
  assert.deepEqual([...new Uint8Array(result)], [1, 2, 3, 4])
})

test('waveform requests reject advertised oversize and cancel unbounded chunked bodies', async () => {
  await assert.rejects(readWaveformAudio(new Response('tiny', { headers: { 'content-length': String(MAX_WAVEFORM_BYTES + 1) } }), new AbortController().signal), /too large/)
  let cancelled = false
  let sent = 0
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) { sent++; controller.enqueue(new Uint8Array([1, 2, 3])) },
    cancel() { cancelled = true },
  })
  await assert.rejects(readWaveformAudio(new Response(stream, { headers: { 'content-length': '1' } }), new AbortController().signal, 5), /too large/)
  assert.equal(cancelled, true)
  assert.ok(sent <= 3, 'Stop reading as soon as the actual body exceeds its limit')
})

test('aborting a pending waveform body cancels the reader', async () => {
  const abort = new AbortController()
  let cancelled = false
  const stream = new ReadableStream<Uint8Array>({ cancel() { cancelled = true } })
  const pending = readWaveformAudio(new Response(stream), abort.signal)
  abort.abort()
  await assert.rejects(pending, { name: 'AbortError' })
  assert.equal(cancelled, true)
})
