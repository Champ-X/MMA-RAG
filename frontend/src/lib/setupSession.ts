const SETUP_TOKEN_KEY = 'tessmora.setup-token'
let tabToken: string | null = null

/** Fragments never reach the web server. Consume before mounting any app UI. */
export function consumeSetupToken(): void {
  if (typeof window === 'undefined') return
  const fragment = new URLSearchParams(window.location.hash.slice(1))
  const token = fragment.get('setup_token')
  if (!token) return
  window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search)
  setSetupToken(token)
}

export function getSetupToken(): string | null {
  try { return tabToken || (typeof sessionStorage === 'undefined' ? null : sessionStorage.getItem(SETUP_TOKEN_KEY)) }
  catch { return tabToken }
}

export function setSetupToken(token: string): void {
  tabToken = token.trim() || null
  try {
    if (tabToken) sessionStorage.setItem(SETUP_TOKEN_KEY, tabToken)
    else sessionStorage.removeItem(SETUP_TOKEN_KEY)
  } catch { /* Restrictive browsers can keep the current tab authenticated in memory. */ }
}

export function getAuthToken(): string | null {
  if (getSetupToken()) return getSetupToken()
  try { return typeof localStorage === 'undefined' ? null : localStorage.getItem('auth_token') }
  catch { return null }
}
