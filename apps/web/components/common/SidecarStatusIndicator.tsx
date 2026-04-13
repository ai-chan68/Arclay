import { useSidecarStatus, type SidecarState } from '../../shared/hooks/useSidecarStatus'
import { isTauri } from '@arclay/shared-types'

const stateConfig: Record<SidecarState, { color: string; label: string }> = {
  connected: { color: '#22c55e', label: 'API 已连接' },
  reconnecting: { color: '#eab308', label: 'API 重连中...' },
  disconnected: { color: '#ef4444', label: 'API 已断开' },
}

/**
 * Small dot indicator showing sidecar connection status.
 * Only renders in Tauri (desktop) mode.
 */
export function SidecarStatusIndicator() {
  const state = useSidecarStatus()

  if (!isTauri()) return null
  if (state === 'connected') return null // Don't clutter UI when healthy

  const { color, label } = stateConfig[state]

  return (
    <div
      title={label}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        padding: '2px 8px',
        borderRadius: '12px',
        fontSize: '12px',
        color,
        background: `${color}15`,
      }}
    >
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          backgroundColor: color,
          animation: state === 'reconnecting' ? 'pulse 1.5s infinite' : undefined,
        }}
      />
      {label}
    </div>
  )
}
