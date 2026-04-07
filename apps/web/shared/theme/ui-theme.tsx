import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

export type UITheme = 'light' | 'dark' | 'system'
type ResolvedUITheme = 'light' | 'dark'

interface UIThemeContextValue {
  theme: UITheme
  resolvedTheme: ResolvedUITheme
  setTheme: (theme: UITheme) => void
  toggleTheme: () => void
}

const STORAGE_KEY = 'easywork-ui-theme'

const UIThemeContext = createContext<UIThemeContextValue | null>(null)

function getStoredTheme(): UITheme {
  if (typeof window === 'undefined') return 'system'
  const storedTheme = window.localStorage.getItem(STORAGE_KEY)
  if (storedTheme === 'light') return 'light'
  if (storedTheme === 'dark') return 'dark'
  if (storedTheme === 'system') return 'system'
  return 'system'
}

function getSystemTheme(): ResolvedUITheme {
  if (typeof window === 'undefined') return 'light'
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function UIThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<UITheme>(getStoredTheme)
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedUITheme>(getSystemTheme)

  useEffect(() => {
    if (typeof window === 'undefined') return

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    const handleChange = () => {
      if (theme === 'system') {
        setResolvedTheme(mediaQuery.matches ? 'dark' : 'light')
      }
    }

    handleChange()
    mediaQuery.addEventListener('change', handleChange)
    return () => mediaQuery.removeEventListener('change', handleChange)
  }, [theme])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const nextResolvedTheme = theme === 'system' ? getSystemTheme() : theme
    setResolvedTheme(nextResolvedTheme)
    window.localStorage.setItem(STORAGE_KEY, theme)
    document.documentElement.setAttribute('data-ui-theme', nextResolvedTheme)
    document.documentElement.setAttribute('data-theme', nextResolvedTheme)
    document.documentElement.classList.toggle('dark', nextResolvedTheme === 'dark')
  }, [theme])

  const value = useMemo<UIThemeContextValue>(() => ({
    theme,
    resolvedTheme,
    setTheme,
    toggleTheme: () => {
      setTheme((prevTheme) => {
        if (prevTheme === 'light') return 'dark'
        if (prevTheme === 'dark') return 'system'
        return 'light'
      })
    },
  }), [theme, resolvedTheme])

  return (
    <UIThemeContext.Provider value={value}>
      {children}
    </UIThemeContext.Provider>
  )
}

export function useUITheme() {
  const context = useContext(UIThemeContext)
  if (!context) {
    throw new Error('useUITheme must be used within UIThemeProvider')
  }
  return context
}
