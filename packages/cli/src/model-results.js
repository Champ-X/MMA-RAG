const taskLabels = {
  final_generation: '回答生成', intent_recognition: '意图识别', query_rewriting: '查询改写',
  embedding: '文本向量', reranking: '检索重排', image_captioning: '图片理解',
  audio_transcription: '音频转写', video_parsing: '视频解析',
  pi_agent: 'Pi 工具调用', pi_embedding: 'Pi 独立向量', pi_vision: 'Pi 独立图片理解', pi_audio: 'Pi 独立音频理解',
};

export function modelResultLine(row) {
  return `${taskLabels[row.task] || row.task || row.capability} · ${row.provider} · ${row.capability} · ${row.model}: ${row.success ? '通过' : row.message || row.error_code || '失败'}`;
}

export function modelTestHint(results = [], { source } = {}) {
  const failed = results.filter(row => !row.success);
  const missing = failed.filter(row => ['not_found', 'model_disabled', 'unsupported'].includes(row.error_code));
  const hints = [];
  if (missing.length) {
    hints.push('服务商未提供所选模型或能力接口，请核对模型 ID、服务地域与模型生命周期。');
    if (source) hints.push('如果刚更新过源码，请先退出当前向导，在原仓库执行 git pull --ff-only，再运行 tessmora setup --rebuild，加载新的模型配置。资料与模型缓存会保留。');
    if (missing.some(row => row.task?.startsWith('pi_'))) hints.push('失败项属于 Pi 的独立模型配置，普通任务测试通过不能替代它。');
  }
  if (failed.some(row => ['authentication', 'access_denied'].includes(row.error_code))) hints.push('检查对应服务商的密钥、模型权限和接入地域。');
  if (!hints.length || failed.some(row => !missing.includes(row))) hints.push('返回上一步可重新填写配置；按失败原因检查余额、限流或网络后重试。');
  return hints.join('\n');
}
