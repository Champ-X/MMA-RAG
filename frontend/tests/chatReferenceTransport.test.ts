import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createChatStream } from '../src/services/sse_stream'

test('multipart keeps positional references, upload IDs and explicit knowledge scope together', async () => {
  const original = globalThis.fetch
  let body: FormData | undefined
  globalThis.fetch = async (_url, init) => {
    const request = new Request('http://localhost/api/chat/stream', init)
    body = await new Response(await request.arrayBuffer(), {
      headers: { 'Content-Type': request.headers.get('Content-Type')! },
    }).formData()
    return new Response('data: {"type":"complete","sessionId":"test"}\n\n', { headers: { 'Content-Type': 'text/event-stream' } })
  }
  try {
    const file = new File(['test'], 'same.png', { type: 'image/png' })
    await new Promise<void>((resolve, reject) => {
      createChatStream('比较@same.png', { onComplete: () => resolve(), onError: reject }, {
        files: [file], attachmentIds: ['upload'], agentMode: 'agent',
        selectedFiles: [{ kbId: 'kb', fileId: 'f', name: 'same.png' }],
        mentions: [{ source: 'attachment', attachmentId: 'upload', name: 'same.png', type: 'image/png', start: 2, end: 11 }],
      })
    })
    assert.equal(body!.get('message'), '比较@same.png')
    assert.equal(JSON.parse(body!.get('messageJson') as string), '比较@same.png')
    assert.equal(body!.get('agentMode'), 'agent')
    assert.deepEqual(JSON.parse(body!.get('attachmentIds') as string), ['upload'])
    assert.deepEqual(JSON.parse(body!.get('selectedFiles') as string)[0], { kb_id: 'kb', file_id: 'f', name: 'same.png' })
    assert.equal(JSON.parse(body!.get('mentions') as string)[0].start, 2)
    assert.equal((body!.get('files') as File).name, 'same.png')
    assert.equal(body!.get('conversationContext'), null, 'legacy requests have no context override')
  } finally { globalThis.fetch = original }
})

test('mixed conversation context uses POST and preserves Chinese history without files', async () => {
  const original = globalThis.fetch
  let received: FormData | undefined
  globalThis.fetch = async (_url, init) => {
    assert.equal(init?.method, 'POST')
    received = init!.body as FormData
    return new Response('data: {"type":"complete"}\n\n')
  }
  try {
    const context = [{ role: 'assistant' as const, content: 'Pi 已确认的定义。' }]
    await new Promise<void>((resolve, reject) => {
      createChatStream('对此展开说明', { onComplete: () => resolve(), onError: reject }, { conversationContext: context, agentMode: 'direct' })
    })
    assert.deepEqual(JSON.parse(String(received!.get('conversationContext'))), context)
    assert.equal(received!.getAll('files').length, 0)
  } finally { globalThis.fetch = original }
})

test('real multipart encoding preserves multiline Unicode text and every reference through JSON', async () => {
  const original = globalThis.fetch
  let received: FormData | undefined
  globalThis.fetch = async (_url, init) => {
    const request = new Request('http://localhost/api/chat/stream', init)
    received = await new Response(await request.arrayBuffer(), {
      headers: { 'Content-Type': request.headers.get('Content-Type')! },
    }).formData()
    return new Response('data: {"type":"complete"}\n\n')
  }
  try {
    const message = '🖼️1、找出和@same.png匹配的图片；\n\n2、分析@long-knowledge-file-name.jpg和@same.png的相似点；\n3、介绍@architecture.png的架构。'
    const mentions = [...message.matchAll(/@(same\.png|long-knowledge-file-name\.jpg|architecture\.png)/g)].map((match, index) => ({
      source: index === 1 || index === 2 ? 'knowledge' as const : 'attachment' as const,
      name: match[1], start: match.index!, end: match.index! + match[0].length, type: 'image/png',
      ...(index === 1 || index === 2 ? { kbId: 'landscape', fileId: `file-${index}` } : { attachmentId: `upload-${index}` }),
    }))
    await new Promise<void>((resolve, reject) => {
      createChatStream(message, { onComplete: () => resolve(), onError: reject }, {
        mentions,
        files: [new File(['first'], 'same.png'), new File(['last'], 'architecture.png')],
        attachmentIds: ['upload-0', 'upload-3'],
      })
    })
    // This distinction is invisible to tests which only inspect FormData.get().
    assert.equal(received!.get('message'), message.replace(/\n/g, '\r\n'))
    const exact = JSON.parse(received!.get('messageJson') as string) as string
    assert.equal(exact, message)
    const refs = JSON.parse(received!.get('mentions') as string)
    assert.deepEqual(refs, mentions)
    for (const ref of refs) assert.equal(exact.slice(ref.start, ref.end), `@${ref.name}`)
    assert.equal(received!.getAll('files').length, 2)
    assert.equal(received!.get('selectedFiles'), null, 'inline mentions must not constrain discovery')
    assert.equal(received!.get('knowledgeBaseIds'), null)
    assert.deepEqual(JSON.parse(received!.get('referenceFiles') as string).map((file: { file_id: string }) => file.file_id), ['file-1', 'file-2'])
  } finally { globalThis.fetch = original }
})

test('a disconnected multipart stream ends with an actionable error instead of spinning forever', async () => {
  const original = globalThis.fetch
  globalThis.fetch = async () => new Response('data: {"type":"connected"}\n\n')
  try {
    const error = await new Promise<unknown>(resolve => {
      createChatStream('test', { onError: resolve }, { selectedFiles: [{ kbId: 'kb', fileId: 'f', name: 'file' }] })
    })
    assert.match((error as Error).message, /连接.*中断/)
  } finally { globalThis.fetch = original }
})
