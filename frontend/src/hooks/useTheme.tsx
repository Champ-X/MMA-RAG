import { createContext, useContext, useState, useEffect, ReactNode } from 'react'

interface ThemeContextType {
  theme: string
  setTheme: (theme: string) => void
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined)

interface ThemeProviderProps {
  children: ReactNode
  defaultTheme?: string
  storageKey?: string
}

export function ThemeProvider({ 
  children, 
  defaultTheme = 'light', 
  storageKey = 'theme' 
}: ThemeProviderProps) {
  const [theme, setTheme] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem(storageKey) || defaultTheme
    }
    return defaultTheme
  })

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const root = document.documentElement
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')

      const applyTheme = (nextTheme: string) => {
        const resolvedTheme =
          nextTheme === 'system'
            ? (mediaQuery.matches ? 'dark' : 'light')
            : nextTheme

        root.setAttribute('data-theme', nextTheme)
        root.classList.toggle('dark', resolvedTheme === 'dark')
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
    <ThemeContext.Provider value={{ theme, setTheme }}>
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
