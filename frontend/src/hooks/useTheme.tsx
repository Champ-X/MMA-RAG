import { createContext, useContext, useState, useEffect, ReactNode } from 'react'

type ThemeMode = 'light' | 'dark' | 'system'
type ResolvedTheme = 'light' | 'dark'

interface ThemeContextType {
  theme: ThemeMode
  resolvedTheme: ResolvedTheme
  setTheme: (theme: ThemeMode) => void
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined)

interface ThemeProviderProps {
  children: ReactNode
  defaultTheme?: ThemeMode
  storageKey?: string
}

export function ThemeProvider({ 
  children, 
  defaultTheme = 'light', 
  storageKey = 'theme' 
}: ThemeProviderProps) {
  const [theme, setTheme] = useState<ThemeMode>(() => {
    if (typeof window !== 'undefined') {
      const storedTheme = localStorage.getItem(storageKey)
      if (storedTheme === 'light' || storedTheme === 'dark' || storedTheme === 'system') {
        return storedTheme
      }
      return defaultTheme
    }
    return defaultTheme
  })
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>('light')

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const root = document.documentElement
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')

      const applyTheme = (nextTheme: ThemeMode) => {
        const nextResolvedTheme: ResolvedTheme =
          nextTheme === 'system'
            ? (mediaQuery.matches ? 'dark' : 'light')
            : nextTheme

        root.setAttribute('data-theme', nextTheme)
        root.classList.toggle('dark', nextResolvedTheme === 'dark')
        setResolvedTheme(nextResolvedTheme)
      }

      localStorage.setItem(storageKey, theme)
      applyTheme(theme)

      if (theme !== 'system') return

      const handleSystemThemeChange = () => applyTheme('system')
      mediaQuery.addEventListener?.('change', handleSystemThemeChange)
      return () => mediaQuery.removeEventListener?.('change', handleSystemThemeChange)
    }
  }, [theme, storageKey])

  return (
    <ThemeContext.Provider value={{ theme, resolvedTheme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  const context = useContext(ThemeContext)
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider')
  }
  return context
}
