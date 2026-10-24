import { translate as t } from '@/i18n'
import type { UploadPipelineProgress } from './UploadPipeline'
/** User-facing stages shared by every upload modality. Percentages come from the server. */
export function uploadStageLabel(status: string, stage?: string): string {
  if (status === 'completed' || status === 'ready') return t("已就绪")
  if (status === 'failed') return t("处理失败")
  if (status === 'queued') return t("排队中")
  if (status === 'uploading') return t("上传中")
  const labels: Record<string, string> = {
    initializing: t("准备解析"), uploading: t("保存原文件"), fetching: t("读取文件"),
    parsing: t("解析内容"), processing: t("解析内容"), asr: t("音频转写"),
    preparing_video: t("准备视频"), preparing_segment: t("准备视频片段"), parsing_segment: t("解析视频片段"),
    scene_shot_parsing: t("解析场景与镜头"), video_scene_shot_parsing: t("解析场景与镜头"),
    vectorizing: t("建立检索索引"), extracting_keyframes: t("提取关键帧"),
    embedding_keyframes: t("建立文字索引"), vectorizing_keyframes: t("建立画面索引"),
    storing: t("保存索引"), portrait: t("更新素材概览"),
  }
  return labels[stage ?? ''] ?? t("处理中")
}

/** Stage progress and completed-file counts describe different parts of the same batch. */
export function uploadBatchPercent(progress: UploadPipelineProgress): number {
  if (progress.stage === 'done') return 100
  if (!progress.submitted) return Math.max(0, Math.min(100, progress.transferProgress ?? 0))
  if (!progress.total) return 0
  const entries = progress.files ?? []
  if (!entries.length) return Math.max(0, Math.min(99, progress.stageProgress ?? 0))
  const sum = entries.reduce((value, file) => value + (
    ['completed', 'ready', 'failed', 'not_found'].includes(file.status) ? 100
      : Math.max(0, Math.min(99, Number.isFinite(file.progress) ? file.progress! : 0))
  ), 0)
  return Math.min(99, Math.round(sum / progress.total))
}

/** Translate known service messages without rewriting model output or unknown diagnostics. */
export function uploadProgressMessage(message?: string): string | undefined {
  if (!message) return undefined
  const segment = message.match(/^(正在准备视频|Qwen Omni 正在解析)第 (\d+)(?:\/(\d+))? 段（([\d.]+)[–-]([\d.]+) 秒）…$/)
  if (segment) {
    const [, phase, index, total, start, end] = segment
    const part = total ? `${index}/${total}` : index
    return t(phase === '正在准备视频'
      ? "正在准备视频第 {{part}} 段（{{start}}–{{end}} 秒）…"
      : "Qwen Omni 正在解析第 {{part}} 段（{{start}}–{{end}} 秒）…", { part, start, end })
  }
  return t(message)
}
