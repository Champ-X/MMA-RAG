/** Stable public probe codes; upstream bodies and transport details are never displayed. */
export function decisionTestErrorMessage(reason?: string): string {
  const messages: Record<string, string> = {
    http_400: '服务未接受当前模型的 Decision 请求。请确认模型支持当前接口与输出格式，或选择其他模型。',
    http_401: '服务商未接受 API 密钥，请检查服务端密钥配置。',
    http_402: '服务商账户余额或额度不足，请检查账户后重试。',
    http_403: '当前网络地区或访问权限受限。请检查服务商可用地区与模型权限，或选择其他模型。',
    http_404: '服务商未找到该模型或 Decision 接口，请选择其他模型。',
    http_429: '服务商请求频率或配额受限，请稍后重试。',
    timeout: '连接测试超时，请稍后重试或选择其他模型。',
    budget_exhausted: '当前模型的调用预算已用尽，请检查服务端预算配置。',
    missing_key: '所选服务商尚未配置 API 密钥，请在服务端配置并重启后重试。',
    model_mismatch: '服务返回的模型与所选模型不一致，无法验证当前选择。请检查服务商路由配置。',
    invalid_probabilities: '模型返回的概率或置信度不符合 Decision 格式，当前模型未通过验证。',
    circuit_open: '服务暂时不可用，请稍后重试。',
  }
  if (reason && messages[reason]) return messages[reason]
  if (reason && /^http_5\d{2}$/.test(reason)) return '服务商暂时不可用，请稍后重试或选择其他模型。'
  return '服务未返回有效的 Decision 输出，当前模型未通过验证。请稍后重试或选择其他模型。'
}
