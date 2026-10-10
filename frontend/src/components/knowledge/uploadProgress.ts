/** User-facing stages shared by every upload modality. Percentages come from the server. */
export function uploadStageLabel(status: string, stage?: string): string {
  if (status === 'completed' || status === 'ready') return '已就绪'
  if (status === 'failed') return '处理失败'
  if (status === 'queued') return '排队中'
  if (status === 'uploading') return '上传中'
  const labels: Record<string, string> = {
    initializing: '准备解析', uploading: '保存原文件', fetching: '读取文件',
    parsing: '解析内容', processing: '解析内容', asr: '音频转写',
    scene_shot_parsing: '解析场景与镜头', video_scene_shot_parsing: '解析场景与镜头',
    vectorizing: '建立检索索引', extracting_keyframes: '提取关键帧',
    embedding_keyframes: '建立文字索引', vectorizing_keyframes: '建立画面索引',
    storing: '保存索引', portrait: '更新素材概览',
  }
  return labels[stage ?? ''] ?? '处理中'
}
