import { translate as t } from '@/i18n'
/** User-facing stages shared by every upload modality. Percentages come from the server. */
export function uploadStageLabel(status: string, stage?: string): string {
  if (status === 'completed' || status === 'ready') return t("已就绪")
  if (status === 'failed') return t("处理失败")
  if (status === 'queued') return t("排队中")
  if (status === 'uploading') return t("上传中")
  const labels: Record<string, string> = {
    initializing: t("准备解析"), uploading: t("保存原文件"), fetching: t("读取文件"),
    parsing: t("解析内容"), processing: t("解析内容"), asr: t("音频转写"),
    scene_shot_parsing: t("解析场景与镜头"), video_scene_shot_parsing: t("解析场景与镜头"),
    vectorizing: t("建立检索索引"), extracting_keyframes: t("提取关键帧"),
    embedding_keyframes: t("建立文字索引"), vectorizing_keyframes: t("建立画面索引"),
    storing: t("保存索引"), portrait: t("更新素材概览"),
  }
  return labels[stage ?? ''] ?? t("处理中")
}
