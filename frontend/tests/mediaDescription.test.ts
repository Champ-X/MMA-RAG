import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseMediaDescription } from '../src/lib/mediaDescription'

test('video headings separate visual evidence and transcript without rewriting body text', () => {
  const visual = '冷色调的街道上，男子戴着鸭舌帽缓步前行。\n\n背景有**红色灯光**与引号“转写”。'
  const transcript = 'The past is not my concern.\n未来也不是。'
  assert.deepEqual(parseMediaDescription(`索引画面描述：${visual}\n语音转写：${transcript}`, 'video'), [
    { id: 'visual', label: '画面摘要', content: visual },
    { id: 'transcript', label: '语音转写', content: transcript },
  ])
  assert.deepEqual(parseMediaDescription('画面摘要：男子走进房间。 语音转写：Hello.', 'video'), [
    { id: 'visual', label: '画面摘要', content: '男子走进房间。' },
    { id: 'transcript', label: '语音转写', content: 'Hello.' },
  ])
})

test('a lone transcript and explicit English or bold headings retain their content', () => {
  assert.deepEqual(parseMediaDescription('音频转写：\n只有声音。', 'video'), [
    { id: 'transcript', label: '语音转写', content: '只有声音。' },
  ])
  assert.deepEqual(parseMediaDescription('**Visual description:** A quiet room.\n**Speech transcript:** Hello.', 'video'), [
    { id: 'visual', label: '画面摘要', content: 'A quiet room.' },
    { id: 'transcript', label: '语音转写', content: 'Hello.' },
  ])
})

test('ordinary prose, quoted labels, preambles and ambiguous repeated headings stay verbatim', () => {
  for (const content of [
    '  一段没有标记的普通描述。\n第二行。  ',
    '这里介绍“语音转写：”这个字段。',
    '说明：\n画面描述：男子向前走。',
    '画面描述：第一段。\n画面描述：第二段。',
  ]) {
    assert.deepEqual(parseMediaDescription(content, 'video'), [{ id: 'description', label: '内容描述', content }])
  }
  assert.deepEqual(parseMediaDescription('画面描述：屏幕写着“语音转写：请勿改动”。', 'video'), [
    { id: 'visual', label: '画面摘要', content: '屏幕写着“语音转写：请勿改动”。' },
  ])
})

test('audio observations preserve actual ranges and the complete multi-paragraph body', () => {
  const body = '**演唱风格：** 男声独唱。\n\n**编曲：** Double Bass。\n'
  assert.deepEqual(parseMediaDescription(`原文件 0–30 秒的声音观察：\n${body}`, 'audio'), [
    { id: 'observation', label: '声音观察', detail: '原文件 0–30 秒', content: body },
  ])
  assert.deepEqual(parseMediaDescription('原文件1.5 - 20.25秒的声音观察：低沉。', 'audio'), [
    { id: 'observation', label: '声音观察', detail: '原文件1.5 - 20.25秒', content: '低沉。' },
  ])
  assert.deepEqual(parseMediaDescription('Audio observation of original file 0–30 seconds:\nA low voice.', 'audio'), [
    { id: 'observation', label: '声音观察', detail: 'original file 0–30 seconds', content: 'A low voice.' },
  ])
})

test('audio indexed descriptions remove only their explicit prefix, with ordinary content unchanged', () => {
  assert.deepEqual(parseMediaDescription('索引描述：低沉的旋律。\n转写：Hello.', 'audio'), [
    { id: 'description', label: '声音描述', content: '低沉的旋律。\n转写：Hello.' },
  ])
  const content = '  一首歌的原始描述。\n'
  assert.deepEqual(parseMediaDescription(content, 'audio'), [{ id: 'description', label: '声音描述', content }])
})

test('empty content yields no description sections', () => {
  for (const kind of ['audio', 'video'] as const) {
    assert.deepEqual(parseMediaDescription('', kind), [])
    assert.deepEqual(parseMediaDescription(' \n\t', kind), [])
  }
})
