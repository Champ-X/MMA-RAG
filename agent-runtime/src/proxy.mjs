/** Node 22 native fetch needs an explicit dispatcher for proxy environment variables. */
import { EnvHttpProxyAgent, setGlobalDispatcher } from 'undici';

export function installProxyFromEnv(env = process.env) {
  const httpProxy = (env.http_proxy || env.HTTP_PROXY || '').trim();
  const httpsProxy = (env.https_proxy || env.HTTPS_PROXY || '').trim();
  if (!httpProxy && !httpsProxy) return null;
  // Never include a potentially authenticated proxy URL in worker diagnostics.
  for (const value of [httpProxy, httpsProxy].filter(Boolean)) {
    try {
      if (!['http:', 'https:'].includes(new URL(value).protocol)) throw new Error();
    } catch {
      throw new Error('Pi HTTP/HTTPS proxy configuration is invalid.');
    }
  }
  const dispatcher = new EnvHttpProxyAgent({ httpProxy, httpsProxy: httpsProxy || httpProxy,
    noProxy: env.no_proxy ?? env.NO_PROXY ?? '' });
  setGlobalDispatcher(dispatcher);
  return dispatcher;
}
