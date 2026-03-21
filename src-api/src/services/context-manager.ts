/**
 * ContextManager — 上下文管理服务
 *
 * 四层架构：
 *   Global  → settings-store (已有)
 *   Session → context.json 文件持久化 (本服务负责)
 *   Task    → TaskPlan in-memory
 *   Step    → tool-use 回调 in-memory
 */

import { join } from 'path'
import { readFile, writeFile, mkdir } from 'fs/promises'
import { existsSync } from 'fs'

export interface SessionContext {
  sessionId: string
  createdAt: string
  lastActiveAt: string
  conversationSummary: string
  activeFiles: string[]
  taskHistory: string[]
}

const MAX_ACTIVE_FILES = 20
const MAX_SUMMARY_LENGTH = 50_000
const CONTEXT_FILENAME = 'context.json'

export class ContextManager {
  // Step-level in-memory variable map: toolUseId → output
  private stepVariables: Map<string, string> = new Map()
  // Task-level variables: key → value
  private taskVariables: Map<string, string> = new Map()
  // Current session context
  private sessionContext: SessionContext | null = null
  // Work directory root
  private workDir: string

  constructor(workDir: string) {
    this.workDir = workDir
  }

  private sessionDir(sessionId: string): string {
    return join(this.workDir, 'sessions', sessionId)
  }

  // --- Session persistence ---

  async load(sessionId: string): Promise<SessionContext> {
    const dir = this.sessionDir(sessionId)
    const filePath = join(dir, CONTEXT_FILENAME)
    if (existsSync(filePath)) {
      try {
        const raw = await readFile(filePath, 'utf8')
        this.sessionContext = JSON.parse(raw) as SessionContext
        return this.sessionContext
      } catch {
        // Corrupted file — start fresh
      }
    }
    this.sessionContext = {
      sessionId,
      createdAt: new Date().toISOString(),
      lastActiveAt: new Date().toISOString(),
      conversationSummary: '',
      activeFiles: [],
      taskHistory: [],
    }
    return this.sessionContext
  }

  async save(sessionId: string): Promise<void> {
    if (!this.sessionContext) return
    this.sessionContext.lastActiveAt = new Date().toISOString()
    // Trim activeFiles to MAX_ACTIVE_FILES most recent
    if (this.sessionContext.activeFiles.length > MAX_ACTIVE_FILES) {
      this.sessionContext.activeFiles = this.sessionContext.activeFiles.slice(-MAX_ACTIVE_FILES)
    }
    // Trim oversized conversation summary
    if (this.sessionContext.conversationSummary.length > MAX_SUMMARY_LENGTH) {
      this.sessionContext.conversationSummary =
        this.sessionContext.conversationSummary.slice(-MAX_SUMMARY_LENGTH)
    }
    const dir = this.sessionDir(sessionId)
    try {
      await mkdir(dir, { recursive: true })
      await writeFile(
        join(dir, CONTEXT_FILENAME),
        JSON.stringify(this.sessionContext, null, 2),
        'utf8'
      )
    } catch (err) {
      console.warn('[ContextManager] Failed to save context:', err)
    }
  }

  getSession(): SessionContext | null {
    return this.sessionContext
  }

  trackFile(filePath: string): void {
    if (!this.sessionContext) return
    if (!this.sessionContext.activeFiles.includes(filePath)) {
      this.sessionContext.activeFiles.push(filePath)
    }
  }

  addTaskToHistory(taskId: string): void {
    if (!this.sessionContext) return
    if (!this.sessionContext.taskHistory.includes(taskId)) {
      this.sessionContext.taskHistory.push(taskId)
    }
  }

  // --- Step-level hooks (called from processSdkMessage) ---

  onToolUse(toolName: string, toolUseId: string, input: Record<string, unknown>): void {
    // Track file paths from write/edit tool calls
    const filePath = input.file_path ?? input.path ?? input.filePath
    if (typeof filePath === 'string') {
      this.trackFile(filePath)
    }
    // Store input as step variable keyed by toolUseId
    this.stepVariables.set(`${toolUseId}:input`, JSON.stringify(input))
    void toolName // reserved for future use
  }

  onToolResult(toolUseId: string, output: string): void {
    this.stepVariables.set(toolUseId, output)
  }

  clearStepVariables(): void {
    this.stepVariables.clear()
  }

  // --- Task-level variables ---

  setTaskVariable(key: string, value: string): void {
    this.taskVariables.set(key, value)
  }

  clearTaskVariables(): void {
    this.taskVariables.clear()
  }

  // --- Variable resolution chain: step → task → session → global ---

  resolve(key: string): string | undefined {
    // Step level
    if (this.stepVariables.has(key)) return this.stepVariables.get(key)
    // Task level
    if (this.taskVariables.has(key)) return this.taskVariables.get(key)
    // Session level
    if (this.sessionContext) {
      const ctx = this.sessionContext as unknown as Record<string, unknown>
      if (key in ctx && typeof ctx[key] === 'string') return ctx[key] as string
    }
    // Global level (not implemented — would read from settings-store)
    return undefined
  }

  // --- Context prompt injection ---

  buildContextPrompt(): string {
    if (!this.sessionContext) return ''
    const parts: string[] = []

    if (this.sessionContext.activeFiles.length > 0) {
      parts.push(
        '## Session Context\n' +
        'Previously accessed files:\n' +
        this.sessionContext.activeFiles.map((f) => `- ${f}`).join('\n')
      )
    }

    if (this.sessionContext.conversationSummary) {
      parts.push(`## Prior Context\n${this.sessionContext.conversationSummary}`)
    }

    return parts.join('\n\n')
  }
}
