import { isTauri } from 'shared-types'

type TauriCommandName = 'get_api_port'

async function invokeDesktopCommand<T>(
  command: TauriCommandName,
  args?: Record<string, unknown>
): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke<T>(command, args)
}

export async function getDesktopApiPort(): Promise<number> {
  if (!isTauri()) {
    return 0
  }

  try {
    const port = await invokeDesktopCommand<number>('get_api_port')
    return port > 0 ? port : 0
  } catch {
    return 0
  }
}
