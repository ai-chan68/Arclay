import { homedir } from 'os'
import path from 'path'

function expandWorkDir(baseWorkDir: string): string {
  const trimmed = baseWorkDir.trim()
  if (trimmed.startsWith('~')) {
    return path.join(homedir(), trimmed.slice(1))
  }
  return trimmed
}

function isSessionsPath(targetPath: string): boolean {
  return /[\\/]sessions[\\/].+/.test(targetPath)
}

export function resolveTaskWorkspaceDir(baseWorkDir: string, taskId: string): string {
  const expanded = expandWorkDir(baseWorkDir)
  if (isSessionsPath(expanded)) {
    return expanded
  }
  return path.join(expanded, 'sessions', taskId)
}

export function resolveTaskInputsDir(baseWorkDir: string, taskId: string): string {
  return path.join(resolveTaskWorkspaceDir(baseWorkDir, taskId), 'inputs')
}

export function resolveTaskTurnsDir(baseWorkDir: string, taskId: string): string {
  return path.join(resolveTaskWorkspaceDir(baseWorkDir, taskId), 'turns')
}

export function resolveTurnWorkspaceDir(baseWorkDir: string, taskId: string, turnId: string): string {
  return path.join(resolveTaskTurnsDir(baseWorkDir, taskId), turnId)
}

export function resolveTurnArtifactsDir(baseWorkDir: string, taskId: string, turnId: string): string {
  return path.join(resolveTurnWorkspaceDir(baseWorkDir, taskId, turnId), 'artifacts')
}

export function resolveTaskRunsDir(baseWorkDir: string, taskId: string): string {
  return path.join(resolveTaskWorkspaceDir(baseWorkDir, taskId), 'runs')
}

export function resolveTaskRunDir(baseWorkDir: string, taskId: string, runId: string): string {
  return path.join(resolveTaskRunsDir(baseWorkDir, taskId), runId)
}

export function resolveTaskContextPath(baseWorkDir: string, taskId: string): string {
  return path.join(resolveTaskWorkspaceDir(baseWorkDir, taskId), 'context.json')
}

export function resolveTaskHistoryPath(baseWorkDir: string, taskId: string): string {
  return path.join(resolveTaskWorkspaceDir(baseWorkDir, taskId), 'history.jsonl')
}
