export type AppShellRailViewModelInput = {
  mobileViewport: boolean
  railCollapsed: boolean
}

export type AppShellRailViewModel = {
  backdropAriaHidden: true
  backdropTabIndex: -1
  desktopToggleExpanded: boolean
  desktopToggleLabel: string
  frameClassName: string
  mobileToggleExpanded: boolean
  mobileToggleLabel: string
  railAriaHidden: boolean
  railAriaLabel: string
  railId: string
  railToggleExpanded: boolean
  railToggleLabel: string
}

export type AppShellKeyboardInput = {
  ctrlKey: boolean
  defaultPrevented: boolean
  isComposing: boolean
  key: string
  metaKey: boolean
  mobileViewport: boolean
  repeat: boolean
  targetEditable?: boolean
}

export type AppShellKeyboardAction = 'closeMobileRail' | 'none' | 'togglePalette'

export type AppShellNavItemMatch = {
  matchPrefix?: string
  to: string
}

const appRailId = 'nexus-primary-navigation'

function normalizedPath(pathname: string) {
  if (!pathname || pathname === '/') return '/'
  return pathname.endsWith('/') ? pathname.slice(0, -1) : pathname
}

export function isAppShellNavItemActive(pathname: string, item: AppShellNavItemMatch): boolean {
  const currentPath = normalizedPath(pathname)
  const itemPath = normalizedPath(item.to)
  const prefix = item.matchPrefix ? normalizedPath(item.matchPrefix) : itemPath
  if (prefix === '/') return currentPath === '/'
  return currentPath === prefix || currentPath.startsWith(`${prefix}/`)
}

export function resolveAppShellActiveNavItem(pathname: string, items: AppShellNavItemMatch[]): string | null {
  const currentPath = normalizedPath(pathname)
  const matches = items
    .map((item) => {
      const itemPath = normalizedPath(item.to)
      const prefix = item.matchPrefix ? normalizedPath(item.matchPrefix) : itemPath
      if (prefix === '/' ? currentPath !== '/' : currentPath !== prefix && !currentPath.startsWith(`${prefix}/`)) return null
      const exact = currentPath === itemPath
      return {
        exact,
        key: item.to,
        length: exact ? itemPath.length + 1000 : prefix.length,
      }
    })
    .filter((item): item is { exact: boolean; key: string; length: number } => Boolean(item))
    .sort((left, right) => right.length - left.length)

  return matches[0]?.key ?? null
}

export function appShellAdvancedActive(pathname: string, items: AppShellNavItemMatch[]): boolean {
  return Boolean(resolveAppShellActiveNavItem(pathname, items))
}

export function buildAppShellRailViewModel({
  mobileViewport,
  railCollapsed,
}: AppShellRailViewModelInput): AppShellRailViewModel {
  const mobileRailOpen = mobileViewport && railCollapsed
  const desktopRailCollapsed = !mobileViewport && railCollapsed
  const desktopToggleLabel = desktopRailCollapsed ? 'Expand navigation' : 'Collapse navigation'
  const mobileToggleLabel = mobileRailOpen ? 'Close navigation' : 'Open navigation'

  return {
    backdropAriaHidden: true,
    backdropTabIndex: -1,
    desktopToggleExpanded: !desktopRailCollapsed,
    desktopToggleLabel,
    frameClassName: `app-frame${railCollapsed ? ' rail-collapsed' : ''}`,
    mobileToggleExpanded: mobileRailOpen,
    mobileToggleLabel,
    railAriaHidden: mobileViewport && !mobileRailOpen,
    railAriaLabel: mobileViewport ? 'Primary navigation drawer' : 'Primary navigation rail',
    railId: appRailId,
    railToggleExpanded: mobileViewport ? mobileRailOpen : !desktopRailCollapsed,
    railToggleLabel: mobileViewport ? mobileToggleLabel : desktopToggleLabel,
  }
}

export function resolveAppShellKeyboardAction({
  ctrlKey,
  defaultPrevented,
  isComposing,
  key,
  metaKey,
  mobileViewport,
  repeat,
  targetEditable,
}: AppShellKeyboardInput): AppShellKeyboardAction {
  if (defaultPrevented || isComposing || repeat || targetEditable) return 'none'
  if ((metaKey || ctrlKey) && key.toLocaleLowerCase() === 'k') return 'togglePalette'
  if (mobileViewport && key === 'Escape') return 'closeMobileRail'
  return 'none'
}
