import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createRequire } from 'node:module'
import React from 'react'
import { JSDOM } from 'jsdom'

const dom = new JSDOM('<html><body><div id="root"></div></body></html>', { url: 'http://localhost:3001' })
for (const key of ['window', 'document', 'HTMLElement', 'Element', 'Node', 'Event', 'localStorage']) {
  Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key as keyof Window] })
}
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator })
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const requireFrontend = createRequire(`${process.cwd()}/package.json`)
const { act } = requireFrontend('react') as typeof import('react')
const { createRoot } = requireFrontend('react-dom/client') as typeof import('react-dom/client')

const videoReason = '检测到与视频载体强相关的主题（教程、演示、录播等），判为隐性增益'
const videoEnglish = 'Detected a video-related topic, such as a tutorial, demonstration or recording; video may enrich the answer.'

test('language toggle localizes saved application reasons without changing query or model explanations', async () => {
  const { ThinkingCapsule } = await import('../src/components/chat/ThinkingCapsule')
  const { LanguageToggle } = await import('../src/i18n/LanguageSelect')
  const { useConfigStore } = await import('../src/store/useConfigStore')
  const root = createRoot(document.getElementById('root')!)
  const saved = {
    intent_type: 'creative', original_query: '根据影片剧情选海报与主题曲', refined_query: '保留原始实体《浴血黑帮》',
    visual_intent: 'explicit_demand', visual_reasoning: '检测到明确的视觉请求关键词',
    audio_intent: 'explicit_demand', audio_reasoning: '模型分析原文：原声音乐有助于理解情绪 [3]',
    video_intent: 'implicit_enrichment', video_reasoning: videoReason,
    agent_mode_auto: true, agent_mode_selected: 'direct',
    agent_mode_reason: '问题目标集中，单轮多模态检索即可完成', _generation_completed: true,
  }
  const original = JSON.stringify(saved)
  await act(async () => {
    useConfigStore.getState().setLanguage('zh-CN')
    root.render(<><LanguageToggle /><ThinkingCapsule thoughtData={saved} /></>)
  })
  assert.ok(document.body.textContent!.includes(videoReason))
  await act(async () => document.querySelector<HTMLButtonElement>('button[aria-label^="切换为 English"]')!.click())
  let text = document.body.textContent!
  assert.ok(text.includes(videoEnglish))
  assert.ok(text.includes('Detected explicit visual request keywords.'))
  assert.ok(text.includes('The request is focused and can be completed with a single multimodal retrieval pass.'))
  assert.ok(!text.includes(videoReason))
  for (const source of [saved.original_query, saved.refined_query, saved.audio_reasoning]) assert.ok(text.includes(source))
  await act(async () => document.querySelector<HTMLButtonElement>('button[aria-label^="Switch to 简体中文"]')!.click())
  text = document.body.textContent!
  assert.ok(text.includes(videoReason))
  assert.ok(!text.includes(videoEnglish))
  assert.equal(JSON.stringify(saved), original)
  await act(async () => root.unmount())
})

test('new English history and complete routing grammar switch back to Chinese; unknown text stays verbatim', async () => {
  const { localizeAgentModeReason, localizeIntentReason } = await import('../src/lib/intentReason')
  const { useConfigStore } = await import('../src/store/useConfigStore')
  await act(async () => useConfigStore.getState().setLanguage('zh-CN'))
  assert.equal(localizeIntentReason(videoEnglish), videoReason)
  assert.equal(localizeAgentModeReason('Includes an in-depth research or solution design goal; Requires comparison or tradeoffs across multiple sets of evidence'),
    '包含深度调研或方案设计目标；需要对比或权衡多组证据')
  await act(async () => useConfigStore.getState().setLanguage('en-US'))
  assert.equal(localizeAgentModeReason('包含深度调研或方案设计目标；需要对比或权衡多组证据'),
    'Includes an in-depth research or solution design goal; Requires comparison or tradeoffs across multiple sets of evidence')
  for (const original of ['模型依据中文资料给出的解释', `${videoReason} 原始资料`,
    '包含深度调研或方案设计目标；模型额外判断', '包含多个问题；包含深度调研或方案设计目标',
    '问题描述较长；问题包含较多约束',
    '包含深度调研或方案设计目标；Requires comparison or tradeoffs across multiple sets of evidence']) {
    assert.equal(localizeIntentReason(original), original)
    assert.equal(localizeAgentModeReason(original), original)
  }
  await act(async () => useConfigStore.getState().setLanguage('zh-CN'))
})
