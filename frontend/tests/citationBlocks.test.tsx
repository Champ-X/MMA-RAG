import assert from 'node:assert/strict'
import { test } from 'node:test'
import { PassThrough } from 'node:stream'
import React from 'react'
import { renderToPipeableStream } from 'react-dom/server'
import { MessageBubble, type MessageBubbleMessage } from '../src/components/chat/MessageBubble'

// Wait for the actual lazy Markdown renderer. Static Suspense fallbacks cannot catch lost media.
function render(content: string, citations?: MessageBubbleMessage['citations']) {
  return new Promise<string>((resolve, reject) => {
    let html = ''
    const output = new PassThrough()
    output.on('data', chunk => { html += chunk.toString() })
    output.on('end', () => resolve(html))
    const stream = renderToPipeableStream(<MessageBubble message={{ id: 'blocks', type: 'assistant',
      content, timestamp: '2026-10-05', citations: citations ?? [
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
