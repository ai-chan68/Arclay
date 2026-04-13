import { useEffect, useState } from 'react'
import { isTauri } from '@arclay/shared-types'

export type SidecarState = 'connected' | 'disconnected' | 'reconnecting'

interface SidecarStatusPayload {
  type: 'Ready' | 'Crashed' | 'Restarting' | 'Restarted' | 'RestartFailed'
  data?: unknown
}

/**
 * Listens for sidecar-status Tauri events emitted by the Rust backend.
 * Returns the current connection state so the UI can display a status indicator.
 * In web (non-Tauri) mode, always returns 'connected'.
 */
export function useSidecarStatus(): SidecarState {
  const [state, setState] = useState<SidecarState>('connected')

  useEffect(() => {
    if (!isTauri()) return

    let unlisten: (() => void) | undefined

    ;(async () => {
      const { listen } = await import('@tauri-apps/api/event')
      unlisten = await listen<SidecarStatusPayload>('sidecar-status', (event) => {
        switch (event.payload.type) {
          case 'Crashed':
            setState('disconnected')
            break
          case 'Restarting':
            setState('reconnecting')
            break
          case 'Ready':
          case 'Restarted':
            setState('connected')
            break
          case 'RestartFailed':
            setState('disconnected')
            break
        }
      })
    })()

    return () => {
      unlisten?.()
    }
  }, [])

  return state
}
