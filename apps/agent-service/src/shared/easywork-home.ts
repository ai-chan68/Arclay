import * as os from 'os'
import * as path from 'path'

const EASYWORK_DIRNAME = '.easywork'

export function resolveEasyWorkHome(): string {
  const configuredHome = process.env.EASYWORK_HOME?.trim()
  if (configuredHome) {
    return configuredHome
  }
  return path.join(os.homedir(), EASYWORK_DIRNAME)
}

export function resolveEasyWorkPath(...segments: string[]): string {
  return path.join(resolveEasyWorkHome(), ...segments)
}
