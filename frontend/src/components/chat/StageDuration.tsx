import { useEffect, useState } from 'react'
import { Clock3 } from 'lucide-react'
import type { StageTiming } from '@/types/sse'
import { formatStageDuration, stageElapsedMs } from '@/lib/stageTiming'

/** Only the active badge ticks, leaving the rest of the thinking panel untouched. */
export function StageDuration({ timing, live, label }: {
  timing?: StageTiming
  live: boolean
  label: string
}) {
  const [, tick] = useState(0)
  const running = live && timing?.status === 'processing'
  useEffect(() => {
    if (!running) return
    const interval = window.setInterval(() => tick(value => value + 1), 100)
    return () => window.clearInterval(interval)
  }, [running])
  if (!timing) return null
  const duration = formatStageDuration(stageElapsedMs(timing, running))
  const state = timing.status === 'cancelled' ? '已停止 · '
    : timing.status === 'failed' ? '失败 · ' : running ? '已用 ' : ''
  return (
    <span
      className="ml-auto inline-flex shrink-0 items-center gap-1 rounded-md bg-white/65 px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-slate-500 dark:bg-slate-950/30 dark:text-slate-400"
      aria-label={`${label}耗时 ${duration}${running ? '，进行中' : ''}`}
      aria-live="off"
      title={running ? '当前已用时间；结束后以服务端实测耗时为准'
        : timing._local_snapshot ? '停止或断开前记录的已用时间' : '服务端阶段耗时'}
    >
      <Clock3 size={10} aria-hidden />
      <span>{timing.status === 'skipped' ? '已跳过' : `${state}${duration}`}</span>
    </span>
  )
}

const substageLabels: Record<string, string> = {
  intent: '意图识别', rewrite: '查询改写', search: '召回', rerank: '重排', reranking: '重排',
}

export function StageTimingDetails({ timing }: { timing?: StageTiming }) {
  const parts = Object.entries(timing?.substage_durations_ms ?? {})
    .filter(([key, duration]) => substageLabels[key] && Number.isFinite(duration) && duration >= 0)
  if (!parts.length) return null
  return (
    <p className="flex flex-wrap gap-x-3 gap-y-1 pl-0.5 text-[10px] tabular-nums text-slate-500 dark:text-slate-400">
      {parts.map(([key, duration]) => <span key={key}>{substageLabels[key]} {formatStageDuration(duration)}</span>)}
    </p>
  )
}
