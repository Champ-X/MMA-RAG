import { WorkspaceError, normalizeRemoteUrl, validId } from './workspaces.mjs';

async function jsonRequest(base, path, token, fetchImpl) {
  const response = await fetchImpl(`${base}${path}`, {
    headers: { Accept: 'application/json', ...(token ? { Authorization: `Bearer ${token}`, 'X-Tessmora-Setup-Token': token } : {}) },
    signal: AbortSignal.timeout(12000), redirect: 'manual',
  });
  if (response.status >= 300 && response.status < 400) throw new WorkspaceError('REDIRECT_REJECTED', '服务地址发生重定向。请填写最终的受信任 HTTPS 地址。');
  return { response, data: await response.json().catch(() => null) };
}
export async function negotiateWorkspace({ url, token, fetchImpl = fetch }) {
  const base = normalizeRemoteUrl(url);
  if (!token) throw new WorkspaceError('CREDENTIAL_REQUIRED', '请填写此工作区的访问凭证。');
  try {
    // The exact sensitive endpoint must reject unauthenticated access, including gateways.
    const anonymous = await jsonRequest(base, '/api/knowledge/', null, fetchImpl);
    if (![401, 403].includes(anonymous.response.status)) throw new WorkspaceError('UNPROTECTED_SERVICE', '此服务尚未保护知识库访问。请由管理员配置全站认证后再连接桌面端。');
    const negotiated = await jsonRequest(base, '/api/desktop/capabilities', token, fetchImpl);
    if ([401, 403].includes(negotiated.response.status)) throw new WorkspaceError('AUTH_FAILED', '访问凭证已失效或权限不足，请重新填写。');
    if (negotiated.response.ok) {
      const info = negotiated.data;
      if (info?.protocol_version !== 1 || !validId(info.workspace_id) || info.auth?.required !== true || info.capabilities?.streaming !== true || info.capabilities?.media_range !== true) throw new WorkspaceError('PROTOCOL_INCOMPATIBLE', '服务协议或媒体能力不兼容，请更新服务端。');
      return { protocol: 1, serverId: info.workspace_id, capabilities: info.capabilities };
    }
    if (negotiated.response.status !== 404) throw new WorkspaceError('SERVICE_UNAVAILABLE', '服务未能返回工作区能力，请稍后重试。');
    // A protected older server can work behind an authenticated gateway, without claiming a server UUID.
    const [health, knowledge, setup] = await Promise.all([
      jsonRequest(base, '/health', token, fetchImpl),
      jsonRequest(base, '/api/knowledge/', token, fetchImpl),
      jsonRequest(base, '/api/setup/status', token, fetchImpl),
    ]);
    if ([health, knowledge, setup].some(result => [401, 403].includes(result.response.status))) throw new WorkspaceError('AUTH_FAILED', '访问凭证已失效或权限不足，请重新填写。');
    if (![health, knowledge, setup].every(r => r.response.ok) || !['ok', 'healthy'].includes(health.data?.status) || typeof setup.data?.ready !== 'boolean' || !knowledge.data) throw new WorkspaceError('PROTOCOL_INCOMPATIBLE', '未能确认此服务兼容 Tessmora，请检查地址或更新服务。');
    return { protocol: 0, serverId: null, capabilities: { streaming: true, media_range: true }, legacy: true };
  } catch (error) {
    if (error instanceof WorkspaceError) throw error;
    throw new WorkspaceError('CONNECTION_FAILED', '无法连接工作区。请检查网络、服务地址和 HTTPS 证书后重试。');
  }
}
