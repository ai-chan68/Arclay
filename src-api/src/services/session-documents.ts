import { access } from 'fs/promises'
import path from 'path'
import { resolveTaskWorkspaceDir } from './workspace-layout'

export interface SessionDocumentRecord {
  id: string
  name: string
  path: string
  type: 'markdown'
}

const SESSION_DOCUMENT_FILENAMES = [
  'task_plan.md',
  'findings.md',
  'progress.md',
] as const

export async function listTaskSessionDocuments(
  workDir: string,
  taskId: string
): Promise<SessionDocumentRecord[]> {
  const sessionDir = resolveTaskWorkspaceDir(workDir, taskId)
  const result: SessionDocumentRecord[] = []

  for (const filename of SESSION_DOCUMENT_FILENAMES) {
    const filePath = path.join(sessionDir, filename)
    try {
      await access(filePath)
      result.push({
        id: `session-doc-${filename.replace(/[^a-zA-Z0-9]/g, '-')}`,
        name: filename,
        path: filePath,
        type: 'markdown',
      })
    } catch {
      // Ignore missing session docs so the runtime API stays resilient.
    }
  }

  return result
}
