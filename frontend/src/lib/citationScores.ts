import { translate as tr } from '@/i18n'
import type { CitationReference, CitationScore } from '@/types/sse'

type ScoredReference = Pick<CitationReference, 'scores' | 'score_version'>

const scoreLabels = {
  final: '综合排序分',
  rerank: '重排得分',
  dense: '语义检索得分',
  sparse: '关键词得分',
  visual: '视觉检索得分',
} as const

export function formatCitationScore(score: unknown, digits = 3): string | null {
  return typeof score === 'number' && Number.isFinite(score) ? score.toFixed(digits) : null
}

function recordedScores(reference?: ScoredReference): CitationScore {
  const scores = reference?.scores
  // 旧接口把各检索通道写死为 0，并将综合排序分放在 rerank 下；不能据此还原原始分数。
  if (reference?.score_version !== 2) return { final: scores?.final ?? scores?.rerank }
  return scores ?? {}
}

export function citationScoreSummary(reference?: ScoredReference, digits = 3) {
  const scores = recordedScores(reference)
  for (const key of ['rerank', 'final', 'dense', 'sparse', 'visual'] as const) {
    const value = formatCitationScore(scores[key], digits)
    if (value !== null) return { label: tr(scoreLabels[key]), value }
  }
  return { label: tr('检索得分'), value: tr('未提供') }
}

export function citationScoreDetails(reference: ScoredReference) {
  const scores = recordedScores(reference)
  const legacy = reference.score_version !== 2
  return {
    entries: (Object.keys(scoreLabels) as Array<keyof typeof scoreLabels>).map(key => ({
      label: tr(scoreLabels[key]),
      value: formatCitationScore(scores[key]) ?? (legacy ? tr('历史未记录') : tr('未提供')),
    })),
    note: legacy
      ? tr('此历史引用未保存分路得分，仅保留综合排序分，无法还原当时的检索与重排得分。')
      : tr('各项得分量纲不同，不表示概率，也不能直接横向比较。未提供表示该通道未命中、未执行或未返回得分，不代表 0。'),
  }
}
