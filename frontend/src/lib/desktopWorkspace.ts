/** Narrow desktop bridge. The renderer never receives installation or workspace credentials. */
export interface DesktopWorkspaceBridge {
  readonly workspaceId: string
  readonly apiOrigin?: string
  readonly hasWorkspaceCredential: boolean
  chooseWorkspace(): Promise<boolean>
}
declare global { interface Window { tessmoraDesktop?: DesktopWorkspaceBridge } }
export function desktopWorkspace(): DesktopWorkspaceBridge | undefined {
  return typeof window === 'undefined' ? undefined : window.tessmoraDesktop
}
export function isDesktopWorkspace(): boolean { return desktopWorkspace()?.hasWorkspaceCredential === true }

/** Preserve resource identity when a server emits absolute same-server API URLs. */
export function workspaceResourceUrl(value: string): string {
  const bridge = desktopWorkspace()
  if (!bridge?.apiOrigin || !/^https?:\/\//i.test(value)) return value
  try {
    const url = new URL(value)
    if (url.origin === new URL(bridge.apiOrigin).origin && url.pathname.startsWith('/api/') && !url.username && !url.password) {
      return `${url.pathname}${url.search}${url.hash}`
    }
  } catch { /* Plain text and third-party signed media addresses are unchanged. */ }
  return value
}
export function normalizeWorkspaceResources<T>(value: T): T {
  if (!desktopWorkspace()?.apiOrigin) return value
  function visit(item: unknown, depth: number): unknown {
    if (typeof item === 'string') return workspaceResourceUrl(item)
    if (!item || depth > 40) return item
    if (Array.isArray(item)) return item.map(child => visit(child, depth + 1))
    if (typeof item === 'object' && Object.getPrototypeOf(item) === Object.prototype) {
      return Object.fromEntries(Object.entries(item).map(([key, child]) => [key, visit(child, depth + 1)]))
    }
    return item
  }
  return visit(value, 0) as T
}
