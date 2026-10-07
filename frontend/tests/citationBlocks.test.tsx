import assert from 'node:assert/strict'
import { test } from 'node:test'
import { PassThrough } from 'node:stream'
import { register } from 'node:module'
import React from 'react'
import { renderToPipeableStream } from 'react-dom/server'
import { MessageBubble, type MessageBubbleMessage } from '../src/components/chat/MessageBubble'

register(new URL('./helpers/ignoreCss.mjs', import.meta.url))

// Wait for the actual lazy Markdown renderer. Static Suspense fallbacks cannot catch lost media.
function render(content: string, citations?: MessageBubbleMessage['citations'], pi?: MessageBubbleMessage['pi']) {
  return new Promise<string>((resolve, reject) => {
    let html = ''
    const output = new PassThrough()
    output.on('data', chunk => { html += chunk.toString() })
    output.on('end', () => resolve(html))
    const stream = renderToPipeableStream(<MessageBubble message={{ id: 'blocks', type: 'assistant',
      content, timestamp: '2026-10-05', pi, citations: citations ?? [
        { id: '9', type: 'audio', source: 'attachment', attachment_id: 'music', file_name: '音乐.mp3', content: '音乐依据' },
        { id: 4, type: 'image', source: 'attachment', attachment_id: 'image', file_name: '园林.png', content: '图片依据' },
      ] }} />, { onAllReady() { stream.pipe(output) }, onError: reject })
  })
}

test('table headers and cells share citation numbering and display first-use media below the table', async () => {
  const html = await render('| 音乐 [9] | 图片 [4] |\n| --- | --- |\n| 柔和 [9] | 宁静 [4] |\n\n结论 [9] [4]。')
  const table = html.slice(html.indexOf('<table'), html.indexOf('</table>') + 8)
  assert.match(table, /<th scope="col"/)
  assert.doesNotMatch(table, /\[9\]|\[4\]|<figure|<audio|<video/)
  assert.equal((table.match(/<button/g) ?? []).length, 4)
  assert.equal((html.match(/data-attachment-evidence="music"/g) ?? []).length, 1)
  assert.equal((html.match(/data-attachment-evidence="image"/g) ?? []).length, 1)
  assert.ok(html.indexOf('data-attachment-evidence="music"') > html.indexOf('</table>'))
  assert.match(html, /本机附件.*\[1\]/)
})

test('heading-first references and nested tight/loose lists show each source once', async () => {
  for (const content of [
    '## 音乐 [9]\n\n补充 [9]。\n\n> 图片 [4]。',
    '- 外层\n  - 内层 [9] [4]\n\n结论 [9] [4]。',
    '- 第一段 [9]\n\n  第二段 [4]\n\n结论 [9] [4]。',
  ]) {
    const html = await render(content)
    assert.equal((html.match(/data-attachment-evidence="music"/g) ?? []).length, 1)
    assert.equal((html.match(/data-attachment-evidence="image"/g) ?? []).length, 1)
    assert.doesNotMatch(html, /<\/(?:li|th|td)><(?:div|figure)/)
  }
})

test('code and links in tables stay literal and do not consume first media placement', async () => {
  const html = await render('| 示例 |\n| --- |\n| `array[9]` 与 [4](https://example.test) |\n\n依据 [9] [4]。')
  const table = html.slice(html.indexOf('<table'), html.indexOf('</table>') + 8)
  assert.doesNotMatch(table, /<button/)
  assert.match(table, /array\[9\]/)
  assert.equal((html.match(/data-attachment-evidence=/g) ?? []).length, 2)
})

test('KB media and video citations in tables keep their players and source identities', async () => {
  const html = await render('| 音频 [7] | 视频 [8] |\n| --- | --- |\n| 安静 | 山水 |', [
    { id: 7, type: 'audio', file_name: 'music.mp3', file_path: 'audios/music.mp3', content: '旋律', audio_url: 'https://example.test/music.mp3', debug_info: { kb_id: 'music' } },
    { id: 8, type: 'video', file_name: 'view.mp4', file_path: 'videos/view.mp4', content: '山水', video_url: 'https://example.test/view.mp4', debug_info: { kb_id: 'landscape' } },
  ])
  assert.ok(html.indexOf('music.mp3', html.indexOf('</table>')) > 0)
  assert.ok(html.indexOf('view.mp4', html.indexOf('</table>')) > 0)
})

test('Pi index and direct observations of one image display it once and retain both citations', async () => {
  const original = '/api/pi/runs/run-a/sources/source-a/content'
  const html = await render('## 推荐图片 [26]\n\n画面观察 [26]，索引补充 [7]。', [
    { id: 26, type: 'image', pi_run_id: 'run-a', file_name: 'group.png', file_path: original,
      img_url: original, content: '直接观察原图' },
    { id: 7, type: 'image', pi_run_id: 'run-a', file_name: 'group.png', file_path: original,
      img_url: original, content: '索引描述', debug_info: { kb_id: 'landscape', chunk_id: 'index-record' } },
  ])
  assert.equal((html.match(/aria-label="查看图片引用：group.png"/g) ?? []).length, 1)
  assert.match(html, /aria-label="查看引用 1"/)
  assert.match(html, /aria-label="查看引用 2"/)
})

test('all cited Pi media display regardless of historical plan roles, with source deduplication', async () => {
  const pi = { runId: 'run-a', requestId: 'request', status: 'completed' as const, seq: 5,
    startedAt: 1, steps: [], evidence: [], draft: '', inlineMediaEvidenceIds: [] }
  const citations = [
    { id: 1, type: 'audio' as const, file_name: 'selected.mp3', file_path: 'audio/selected', audio_url: 'https://example.test/selected.mp3', content: '选中素材' },
    { id: 2, type: 'audio' as const, file_name: 'selected.mp3', file_path: 'audio/selected', audio_url: 'https://example.test/selected.mp3', content: '同源辅助观察' },
    { id: 3, type: 'image' as const, file_name: 'selected.png', file_path: 'image/selected', img_url: 'https://example.test/selected.png', content: '选中素材' },
    { id: 4, type: 'image' as const, file_name: 'support.png', file_path: 'image/support', img_url: 'https://example.test/support.png', content: '备选素材' },
    { id: 5, type: 'video' as const, file_name: 'selected.mp4', file_path: 'video/selected', video_url: 'https://example.test/selected.mp4', content: '选中片段' },
    { id: 6, type: 'video' as const, file_name: 'support.mp4', file_path: 'video/support', video_url: 'https://example.test/support.mp4', content: '备选素材' },
  ]
  const html = await render('依据[2][4][6]。\n\n## 结果[1][3][5]\n\n再次引用[1]。', citations, pi)
  assert.equal((html.match(/aria-label="播放音频引用/g) ?? []).length, 1)
  assert.equal((html.match(/aria-label="查看图片引用/g) ?? []).length, 2)
  assert.equal((html.match(/aria-label="打开视频引用/g) ?? []).length, 2)
  assert.match(html, /aria-label="查看图片引用：support.png"/)
  for (let i = 1; i <= 6; i++) assert.ok(html.includes(`aria-label="查看引用 ${i}"`))
  const referencesOnly = await render('依据[1][3][5]。', citations, pi)
  assert.equal((referencesOnly.match(/aria-label="(?:播放音频引用|查看图片引用|打开视频引用)/g) ?? []).length, 3)
  assert.match(referencesOnly, /aria-label="查看引用 1"/)
})

test('Pi task notes follow the answer and media, preserve history and start collapsed', async () => {
  const pi = { runId: 'history-run', requestId: 'request', status: 'partial' as const, seq: 5,
    startedAt: 1, steps: [], evidence: [], draft: '', limitations: ['本次未取得用户要求的场地容量。', '历史来源范围说明。'] }
  const original = structuredClone(pi)
  const html = await render('## 推荐结果\n\n匹配素材[4]。\n\n正文结束。', undefined, pi)
  const notesIndex = html.indexOf('data-pi-answer-notes')
  assert.ok(notesIndex > html.indexOf('正文结束。'))
  assert.ok(notesIndex > html.indexOf('data-attachment-evidence="image"'))
  const notes = html.slice(html.lastIndexOf('<details', notesIndex))
  assert.doesNotMatch(notes.slice(0, notes.indexOf('>')), /\bopen\b/)
  assert.match(notes, /任务说明/)
  for (const note of pi.limitations) assert.equal(html.split(note).length - 1, 1)
  assert.doesNotMatch(html.slice(0, notesIndex), /尚未覆盖/)
  assert.deepEqual(pi, original, 'Displaying notes must not reclassify historical statuses or text')
  assert.doesNotMatch(await render('已交付结果。', [], { ...pi, status: 'completed', limitations: [] }), /data-pi-answer-notes/)
})
