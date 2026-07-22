import { useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  resolveTheme,
  ThemeContext,
  themeStorageKey,
  type ThemePreference,
} from './theme'
import { readBrowserStorageItem, writeBrowserStorageItem } from '@/lib/browserStorage'

function storedPreference(): ThemePreference {
  const stored = readBrowserStorageItem('local', themeStorageKey)
  return stored === 'light' || stored === 'dark' || stored === 'system' ? stored : 'system'
}

function prefersDarkColorScheme() {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-color-scheme: dark)').matches
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreference] = useState<ThemePreference>(storedPreference)
  const [systemDark, setSystemDark] = useState(prefersDarkColorScheme)
  const resolvedTheme = resolveTheme(preference, systemDark)

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const update = (event: MediaQueryListEvent) => setSystemDark(event.matches)
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])

  useEffect(() => {
    writeBrowserStorageItem('local', themeStorageKey, preference)
    document.documentElement.dataset.theme = resolvedTheme
    document.documentElement.dataset.themePreference = preference
    document.documentElement.style.colorScheme = resolvedTheme
  }, [preference, resolvedTheme])

  const value = useMemo(() => ({ preference, resolvedTheme, setPreference }), [preference, resolvedTheme])
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}
