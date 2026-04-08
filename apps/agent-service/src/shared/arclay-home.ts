import * as os from 'os'
import * as path from 'path'

const ARCLAY_DIRNAME = '.arclay'

export function resolveArclayHome(): string {
  const configuredHome = process.env.ARCLAY_HOME?.trim()
  if (configuredHome) {
    return configuredHome
  }
  return path.join(os.homedir(), ARCLAY_DIRNAME)
}

export function resolveArclayPath(...segments: string[]): string {
  return path.join(resolveArclayHome(), ...segments)
}
