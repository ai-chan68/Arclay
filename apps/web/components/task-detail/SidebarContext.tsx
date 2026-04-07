/**
 * Sidebar Context
 * 管理侧边栏状态
 */

import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react'

interface SidebarContextType {
  isLeftOpen: boolean
  isRightOpen: boolean
  rightPanelWidth: number
  toggleLeft: () => void
  toggleRight: () => void
  setLeftOpen: (open: boolean) => void
  setRightOpen: (open: boolean) => void
  setRightPanelWidth: (width: number) => void
}

const SidebarContext = createContext<SidebarContextType | null>(null)

const SIDEBAR_LEFT_KEY = 'easywork.sidebar.left-open'
const SIDEBAR_RIGHT_KEY = 'easywork.sidebar.right-open'
const SIDEBAR_RIGHT_WIDTH_KEY = 'easywork.sidebar.right-width'

const RIGHT_PANEL_MIN_WIDTH = 320
const RIGHT_PANEL_MAX_WIDTH = 560
const RIGHT_PANEL_DEFAULT_WIDTH = 380

function readBoolean(key: string, fallback: boolean): boolean {
  if (typeof window === 'undefined') return fallback
  const value = window.localStorage.getItem(key)
  if (value === 'true') return true
  if (value === 'false') return false
  return fallback
}

function clampWidth(width: number): number {
  return Math.min(RIGHT_PANEL_MAX_WIDTH, Math.max(RIGHT_PANEL_MIN_WIDTH, width))
}

function readWidth(): number {
  if (typeof window === 'undefined') return RIGHT_PANEL_DEFAULT_WIDTH
  const raw = window.localStorage.getItem(SIDEBAR_RIGHT_WIDTH_KEY)
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN
  if (Number.isNaN(parsed)) return RIGHT_PANEL_DEFAULT_WIDTH
  return clampWidth(parsed)
}

export function SidebarProvider({ children }: { children: ReactNode }) {
  const [isLeftOpen, setIsLeftOpen] = useState<boolean>(() => readBoolean(SIDEBAR_LEFT_KEY, true))
  const [isRightOpen, setIsRightOpen] = useState<boolean>(() => readBoolean(SIDEBAR_RIGHT_KEY, false))
  const [rightPanelWidth, setRightPanelWidthState] = useState<number>(() => readWidth())

  const toggleLeft = useCallback(() => setIsLeftOpen((prev) => !prev), [])
  const toggleRight = useCallback(() => setIsRightOpen((prev) => !prev), [])
  const setLeftOpen = useCallback((open: boolean) => setIsLeftOpen(open), [])
  const setRightOpen = useCallback((open: boolean) => setIsRightOpen(open), [])
  const setRightPanelWidth = useCallback((width: number) => {
    setRightPanelWidthState(clampWidth(width))
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(SIDEBAR_LEFT_KEY, String(isLeftOpen))
    window.localStorage.setItem(SIDEBAR_RIGHT_KEY, String(isRightOpen))
    window.localStorage.setItem(SIDEBAR_RIGHT_WIDTH_KEY, String(rightPanelWidth))
  }, [isLeftOpen, isRightOpen, rightPanelWidth])

  return (
    <SidebarContext.Provider
      value={{
        isLeftOpen,
        isRightOpen,
        rightPanelWidth,
        toggleLeft,
        toggleRight,
        setLeftOpen,
        setRightOpen,
        setRightPanelWidth,
      }}
    >
      {children}
    </SidebarContext.Provider>
  )
}

export function useSidebar() {
  const context = useContext(SidebarContext)
  if (!context) {
    throw new Error('useSidebar must be used within SidebarProvider')
  }
  return context
}
