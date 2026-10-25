import { getLanguage } from '@/i18n'

// Only application-owned diagnostics are localized. Model explanations, queries
// and source text are not translation keys. Keep these pairs in sync with the
// request-scoped diagnostics in intent.py, jev_intent.py, decision_plan.py and
// agent/mode_router.py.
const intentReasons: Record<string, string> = {
  "保留生成式规划的有效媒体意图，未做关键词覆盖": "Retained the valid media intent from the generated plan without a keyword override.",
  "检测到明确的视觉相关关键词": "Detected explicit visual keywords.",
  "未检测到明确的视觉需求": "No explicit visual need detected.",
  "检测到明确的音频请求关键词": "Detected explicit audio request keywords.",
  "检测到与音频载体强相关的主题（歌词/播客/会议等）": "Detected an audio-related topic, such as lyrics, podcasts or meetings.",
  "未检测到音频需求": "No audio need detected.",
  "检测到明确的视频请求关键词": "Detected explicit video request keywords.",
  "检测到与视频载体强相关的主题（教程、演示、录播等），判为隐性增益": "Detected a video-related topic, such as a tutorial, demonstration or recording; video may enrich the answer.",
  "未检测到视频需求": "No video need detected.",
  "基于查询内容分析": "Analyzed the query content.",
  "检测到明确的视觉请求关键词": "Detected explicit visual request keywords.",
  "检测到与视觉/空间/展示强相关的主题（架构、风光、对比等），判为隐性增益": "Detected a visual or spatial topic, such as architecture, scenery or comparisons; images may enrich the answer.",
  "检测到明确的视觉请求关键词，优先判断为显式需求": "Detected explicit visual request keywords; prioritized the explicit request.",
  "检测到明确的音频请求关键词，优先判断为显式需求": "Detected explicit audio request keywords; prioritized the explicit request.",
  "检测到明确的视频请求关键词（如'结合视频'、'看视频'等），优先判断为显式需求": "Detected explicit video request keywords; prioritized the explicit request.",
  "使用默认规则进行简单分析": "Used default rules for a basic analysis.",
  "使用默认规则，未检测到明确的视觉需求": "Using default rules: no explicit visual need detected.",
  "使用默认规则，未检测到音频需求": "Using default rules: no audio need detected.",
  "使用默认规则，未检测到视频需求": "Using default rules: no video need detected.",
  "Decision 补充已确定的独立证据需求，保留原查询规划": "Decision added a confirmed independent evidence requirement while retaining the original query plan.",
  "Decision 模型识别检索意图，查询改写在后续阶段完成": "Decision identified the retrieval intent; query rewriting follows in a later stage.",
  "根据实际证据需求判断，区分引用、否定与媒体请求": "Assessed the actual evidence needs, distinguishing quotations, negation and media requests.",
  "Decision 核验当前用户原话中的来源需求，保留原查询规划": "Decision verified source requirements in the user's current words while retaining the original query plan.",
  "已手动启用 Agent 深研": "Agent deep research was enabled manually.",
  "已手动选择直接检索": "Direct retrieval was selected manually.",
  "问题目标集中，单轮多模态检索即可完成": "The request is focused and can be completed with a single multimodal retrieval pass."
}

// Auto routing emits at most three fragments from mode_router.py, in this order.
const modeReasonParts: Record<string, string> = {
  "包含深度调研或方案设计目标": "Includes an in-depth research or solution design goal",
  "需要对比或权衡多组证据": "Requires comparison or tradeoffs across multiple sets of evidence",
  "包含多个独立子任务": "Includes multiple independent subtasks",
  "需要分析或综合证据": "Requires analysis or synthesis of evidence",
  "需要跨模态取证": "Requires evidence across modalities",
  "包含多个问题": "Includes multiple questions",
  "问题描述较长": "Has a long question description",
  "问题包含较多约束": "Includes several constraints",
  "指定了多个证据文件": "Specifies multiple evidence files",
  "需要结合附件与知识库": "Requires combining attachments with the knowledge base"
}

const canonicalReasons = new Map(Object.entries(intentReasons).flatMap(([zh, en]) => [[zh, zh], [en, zh]]))
const canonicalModeParts = new Map(Object.entries(modeReasonParts).flatMap(([zh, en]) => [[zh, zh], [en, zh]]))

export function localizeIntentReason(text: string | undefined): string | undefined {
  if (!text) return text
  const canonical = canonicalReasons.get(text)
  return canonical ? (getLanguage() === 'en-US' ? intentReasons[canonical] : canonical) : text
}

export function localizeAgentModeReason(text: string | undefined): string | undefined {
  if (!text) return text
  const fixed = localizeIntentReason(text)
  if (fixed !== text || canonicalReasons.has(text)) return fixed

  // Recognize the complete generated grammar. A mixed or unknown explanation
  // stays verbatim, including punctuation and spacing.
  const parts = text.includes('；') ? text.split('；') : text.split('; ')
  const canonical = parts.map(part => canonicalModeParts.get(part))
  const order = Object.keys(modeReasonParts)
  if (parts.length > 3 || canonical.some(part => !part) ||
      canonical.some((part, index) => index > 0 && order.indexOf(part!) <= order.indexOf(canonical[index - 1]!))) return text
  if (canonical.includes('问题描述较长') && canonical.includes('问题包含较多约束')) return text
  if (text !== canonical.join('；') && text !== canonical.map(part => modeReasonParts[part!]).join('; ')) return text
  return canonical.map(part => getLanguage() === 'en-US' ? modeReasonParts[part!] : part).join(getLanguage() === 'en-US' ? '; ' : '；')
}
