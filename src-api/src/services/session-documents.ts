import { access } from 'fs/promises'
import path from 'path'
import { resolveTaskWorkspaceDir } from './workspace-layout'

export interface SessionDocumentRecord {
  id: string
  name: string
  path: string
  type: 'markdown' | 'text'
}

const SESSION_DOCUMENT_FILENAMES = [
  { name: 'history.jsonl', type: 'text' as const },
  { name: 'task_plan.md', type: 'markdown' as const },
  { name: 'progress.md', type: 'markdown' as const },
  { name: 'findings.md', type: 'markdown' as const },
] as const

export async function listTaskSessionDocuments(
  workDir: string,
  taskId: string
): Promise<SessionDocumentRecord[]> {
  const sessionDir = resolveTaskWorkspaceDir(workDir, taskId)
  const result: SessionDocumentRecord[] = []

  for (const entry of SESSION_DOCUMENT_FILENAMES) {
    const filePath = path.join(sessionDir, entry.name)
    try {
      await access(filePath)
      result.push({
        id: `session-doc-${entry.name.replace(/[^a-zA-Z0-9]/g, '-')}`,
        name: entry.name,
        path: filePath,
        type: entry.type,
      })
    } catch {
      // Ignore missing session docs so the runtime API stays resilient.
    }
  }

  return result
}
