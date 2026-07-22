import { describe, expect, it } from 'vitest'
import {
  appShellAdvancedActive,
  buildAppShellRailViewModel,
  isAppShellNavItemActive,
  resolveAppShellActiveNavItem,
  resolveAppShellKeyboardAction,
} from './appShellViewModel'

describe('buildAppShellRailViewModel', () => {
  it('describes an expanded desktop rail', () => {
    expect(buildAppShellRailViewModel({ mobileViewport: false, railCollapsed: false })).toMatchObject({
      backdropAriaHidden: true,
      backdropTabIndex: -1,
      desktopToggleExpanded: true,
      desktopToggleLabel: 'Collapse navigation',
      frameClassName: 'app-frame',
      mobileToggleExpanded: false,
      mobileToggleLabel: 'Open navigation',
      railAriaHidden: false,
      railAriaLabel: 'Primary navigation rail',
      railToggleExpanded: true,
      railToggleLabel: 'Collapse navigation',
    })
  })

  it('describes a collapsed desktop rail', () => {
    expect(buildAppShellRailViewModel({ mobileViewport: false, railCollapsed: true })).toMatchObject({
      backdropAriaHidden: true,
      backdropTabIndex: -1,
      desktopToggleExpanded: false,
      desktopToggleLabel: 'Expand navigation',
      frameClassName: 'app-frame rail-collapsed',
      mobileToggleExpanded: false,
      mobileToggleLabel: 'Open navigation',
      railAriaHidden: false,
      railAriaLabel: 'Primary navigation rail',
      railToggleExpanded: false,
      railToggleLabel: 'Expand navigation',
    })
  })

  it('describes a closed mobile navigation drawer', () => {
    expect(buildAppShellRailViewModel({ mobileViewport: true, railCollapsed: false })).toMatchObject({
      backdropAriaHidden: true,
      backdropTabIndex: -1,
      desktopToggleExpanded: true,
      desktopToggleLabel: 'Collapse navigation',
      frameClassName: 'app-frame',
      mobileToggleExpanded: false,
      mobileToggleLabel: 'Open navigation',
      railAriaHidden: true,
      railAriaLabel: 'Primary navigation drawer',
      railToggleExpanded: false,
      railToggleLabel: 'Open navigation',
    })
  })

  it('describes an open mobile navigation drawer', () => {
    expect(buildAppShellRailViewModel({ mobileViewport: true, railCollapsed: true })).toMatchObject({
      backdropAriaHidden: true,
      backdropTabIndex: -1,
      desktopToggleExpanded: true,
      desktopToggleLabel: 'Collapse navigation',
      frameClassName: 'app-frame rail-collapsed',
      mobileToggleExpanded: true,
      mobileToggleLabel: 'Close navigation',
      railAriaHidden: false,
      railAriaLabel: 'Primary navigation drawer',
      railToggleExpanded: true,
      railToggleLabel: 'Close navigation',
    })
  })
})

describe('AppShell navigation active matching', () => {
  const items = [
    { to: '/models/setup', matchPrefix: '/models' },
    { to: '/system/status', matchPrefix: '/system' },
    { to: '/system/backups' },
    { to: '/system/settings' },
    { to: '/tools' },
  ]

  it('keeps advanced parent destinations active across their nested sections', () => {
    expect(isAppShellNavItemActive('/models/catalog', items[0])).toBe(true)
    expect(isAppShellNavItemActive('/models/routing', items[0])).toBe(true)
    expect(isAppShellNavItemActive('/system/storage', items[1])).toBe(true)
    expect(isAppShellNavItemActive('/system/settings', items[1])).toBe(true)
  })

  it('does not mark similarly prefixed routes as active', () => {
    expect(isAppShellNavItemActive('/model-settings', items[0])).toBe(false)
    expect(isAppShellNavItemActive('/systematic-review', items[1])).toBe(false)
    expect(isAppShellNavItemActive('/toolshed', items[2])).toBe(false)
  })

  it('opens the advanced group for any matched advanced item', () => {
    expect(appShellAdvancedActive('/models/providers', items)).toBe(true)
    expect(appShellAdvancedActive('/evidence', items)).toBe(false)
  })

  it('resolves the most specific active item when section and child routes overlap', () => {
    expect(resolveAppShellActiveNavItem('/models/providers', items)).toBe('/models/setup')
    expect(resolveAppShellActiveNavItem('/system/storage', items)).toBe('/system/status')
    expect(resolveAppShellActiveNavItem('/system/backups', items)).toBe('/system/backups')
    expect(resolveAppShellActiveNavItem('/system/settings', items)).toBe('/system/settings')
    expect(resolveAppShellActiveNavItem('/evidence', items)).toBeNull()
  })
})

describe('resolveAppShellKeyboardAction', () => {
  const baseEvent = {
    ctrlKey: false,
    defaultPrevented: false,
    isComposing: false,
    key: '',
    metaKey: false,
    mobileViewport: false,
    repeat: false,
  }

  it('opens or closes the command palette with the platform shortcut', () => {
    expect(resolveAppShellKeyboardAction({ ...baseEvent, key: 'k', metaKey: true })).toBe('togglePalette')
    expect(resolveAppShellKeyboardAction({ ...baseEvent, key: 'K', ctrlKey: true })).toBe('togglePalette')
  })

  it('closes the mobile rail with Escape only on mobile viewports', () => {
    expect(resolveAppShellKeyboardAction({ ...baseEvent, key: 'Escape', mobileViewport: true })).toBe('closeMobileRail')
    expect(resolveAppShellKeyboardAction({ ...baseEvent, key: 'Escape', mobileViewport: false })).toBe('none')
  })

  it('lets focused widgets and composition sessions own their keystrokes', () => {
    expect(resolveAppShellKeyboardAction({ ...baseEvent, defaultPrevented: true, key: 'Escape', mobileViewport: true })).toBe('none')
    expect(resolveAppShellKeyboardAction({ ...baseEvent, isComposing: true, key: 'k', metaKey: true })).toBe('none')
    expect(resolveAppShellKeyboardAction({ ...baseEvent, key: 'k', metaKey: true, repeat: true })).toBe('none')
    expect(resolveAppShellKeyboardAction({ ...baseEvent, key: 'k', metaKey: true, targetEditable: true })).toBe('none')
    expect(resolveAppShellKeyboardAction({ ...baseEvent, key: 'Escape', mobileViewport: true, targetEditable: true })).toBe('none')
  })
})
