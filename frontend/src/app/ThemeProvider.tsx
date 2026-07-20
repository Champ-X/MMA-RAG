import { useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  resolveTheme,
  ThemeContext,
  themeStorageKey,
  type ThemePreference,
} from './theme'

function storedPreference(): ThemePreference {
  const stored = window.localStorage.getItem(themeStorageKey)
  return stored === 'light' || stored === 'dark' || stored === 'system' ? stored : 'system'
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreference] = useState<ThemePreference>(storedPreference)
  const [systemDark, setSystemDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches)
  const resolvedTheme = resolveTheme(preference, systemDark)

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const update = (event: MediaQueryListEvent) => setSystemDark(event.matches)
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])

  useEffect(() => {
    window.localStorage.setItem(themeStorageKey, preference)
    document.documentElement.dataset.theme = resolvedTheme
    document.documentElement.dataset.themePreference = preference
    document.documentElement.style.colorScheme = resolvedTheme
  }, [preference, resolvedTheme])

  const value = useMemo(() => ({ preference, resolvedTheme, setPreference }), [preference, resolvedTheme])
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}
