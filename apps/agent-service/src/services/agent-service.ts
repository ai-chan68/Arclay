/**
 * Agent Service - 编排 Agent 执行
 *
 * 架构（Arclay 模式）：
 *   所有 provider 统一通过 Claude Agent SDK 执行。
 *   非 Anthropic 原生 API（OpenRouter、火山引擎等）通过设置 ANTHROPIC_BASE_URL 透传。
 *   SDK 内部完成多轮 tool-use loop，无需手动管理循环。
 *
 * 工作流：
 *   用户输入 → API /agent → AgentService → ClaudeAgent → Claude Agent SDK → SSE 流式返回
 */

import { join } from 'path'
import { writeFile, mkdir, appendFile, readFile } from 'fs/promises'
import type {
  AgentMessage,
  ProviderConfig,
  ToolDefinition,
  MessageAttachment,
} from '@shared-types'
import type { ConversationMessage, IAgent, AgentRunOptions } from '../core/agent/interface'
import type { SkillsConfig, McpConfig, SandboxConfig, ImageAttachment } from '../core/agent/types'
import { agentRegistry } from '../core/agent/registry'
import { getDefaultSystemPrompt } from '../core/agent/system-prompt'
import { ContextManager } from './context-manager'
import { intentClassifier } from './intent-classifier'
import { MemoryStore } from './memory/memory-store'
import { HistoryLogger } from './memory/history-logger'
import { generateDailySummary } from './memory/daily-memory'
import { resolveTaskInputsDir, resolveTaskWorkspaceDir } from './workspace-layout'
import { KnowledgeNotesStore } from './knowledge-notes-store'
import { resolveArclayHome } from '../shared/arclay-home'
import { createLogger } from '../shared/logger'

const log = createLogger('agent-service')

/**
 * Generate session work directory path (must match claude.ts logic)
 *
 * 注意：此函数必须与 claude.ts 中的 getSessionWorkDir 保持逻辑一致
 * 以确保文件保存路径和执行路径相同
 */
function getSessionWorkDir(baseWorkDir: string, storageRootId: string): string {
  return resolveTaskWorkspaceDir(baseWorkDir, storageRootId)
}

function collectArtifactsFromToolOutput(toolOutput?: string): string[] {
  if (!toolOutput) return []

  try {
    const parsed = JSON.parse(toolOutput) as { artifacts?: unknown }
    if (!Array.isArray(parsed.artifacts)) return []
    return parsed.artifacts.filter((value): value is string => typeof value === 'string' && value.length > 0)
  } catch {
    return []
  }
}

async function appendTaskMetricsRecord(input: {
  taskId: string
  runId: string
  success: boolean
  durationMs: number
  model: string
  provider: string
  artifacts: string[]
  timestamp: Date
  providerResultSubtype?: string
  providerDurationMs?: number
  providerTotalCostUsd?: number
  warningCount?: number
  errorCount?: number
}): Promise<void> {
  const metricsDir = join(resolveArclayHome(), 'metrics')
  const month = input.timestamp.toISOString().slice(0, 7)
  const metricsPath = join(metricsDir, `${month}.jsonl`)

  await mkdir(metricsDir, { recursive: true })

  let attempt = 1
  try {
    const existing = await readFile(metricsPath, 'utf8')
    const lines = existing.split('\n').filter(Boolean)
    attempt += lines
      .map((line) => {
        try {
          return JSON.parse(line) as { runId?: string }
        } catch {
          return null
        }
      })
      .filter((record): record is { runId?: string } => record !== null && record.runId === input.runId)
      .length
  } catch {
    attempt = 1
  }

  const record = {
    ts: input.timestamp.toISOString(),
    taskId: input.taskId,
    runId: input.runId,
    attempt,
    success: input.success,
    durationMs: input.durationMs,
    model: input.model,
    provider: input.provider,
    artifacts: input.artifacts,
    providerResultSubtype: input.providerResultSubtype,
    providerDurationMs: input.providerDurationMs,
    providerTotalCostUsd: input.providerTotalCostUsd,
    warningCount: input.warningCount,
    errorCount: input.errorCount,
  }

  await appendFile(metricsPath, `${JSON.stringify(record)}\n`, 'utf8')
}

interface RunningSession {
  agent: IAgent
  abortController: AbortController
}

export interface AgentServiceConfig {
  provider: ProviderConfig
  workDir: string
  systemPrompt?: string
  skills?: SkillsConfig
  mcp?: McpConfig
  sandbox?: SandboxConfig
}

export interface StreamExecutionOptions {
  workDir?: string
  taskId?: string
  turnId?: string
  systemPrompt?: string
  plan?: import('../types/agent-new').TaskPlan

}

export class AgentService {
  private config: AgentServiceConfig
  private runningSessions: Map<string, RunningSession> = new Map()

  constructor(config: AgentServiceConfig) {
    this.config = config
  }

  /**
   * 统一通过 ClaudeAgent 创建 Agent 实例。
   * 无论用户选择哪个 provider，都走 Claude SDK，
   * 通过 baseUrl / apiKey / model 控制实际的 API 端点。
   */
  createAgent(config?: ProviderConfig): IAgent {
    const agentConfig = config || this.config.provider
    const requestedType = agentConfig.provider
    const plugin =
      agentRegistry.getPlugin(requestedType) ||
      agentRegistry.getPlugin('claude')

    if (!plugin) {
      throw new Error('No agent plugins registered. Please call initializeProviders() first.')
    }

    if (requestedType !== plugin.metadata.type) {
      log.warn(
        { requested: requestedType, fallback: plugin.metadata.type },
        'Provider not registered, falling back'
      )
    }

    log.debug({
      provider: requestedType,
      model: agentConfig.model,
      baseUrl: agentConfig.baseUrl,
      apiKey: agentConfig.apiKey ? `${agentConfig.apiKey.slice(0, 8)}...${agentConfig.apiKey.slice(-4)}` : '(empty)',
    }, 'Creating agent')
    const provider = plugin.factory()
    return provider.createAgent({
      provider: 'claude',
      apiKey: agentConfig.apiKey,
      baseUrl: agentConfig.baseUrl,
      model: agentConfig.model,
      workDir: this.config.workDir,
    })
  }

  /**
   * 将 MessageAttachment 转换为 ImageAttachment
   */
  private convertAttachmentsToImages(attachments?: MessageAttachment[]): ImageAttachment[] {
    if (!attachments || attachments.length === 0) return []

    return attachments
      .filter(att => att.type.startsWith('image/'))
      .map(att => ({
        data: att.data,
        mimeType: att.type,
      }))
  }

  /**
   * 提取非图片附件的文件信息
   */
  private extractFileAttachments(attachments?: MessageAttachment[]): Array<{ name: string; type: string; data: string; category: 'spreadsheet' | 'document' | 'presentation' | 'code' | 'other' }> {
    if (!attachments || attachments.length === 0) return []

    // 支持的文档类型及其分类
    const documentTypeMap: Record<string, 'spreadsheet' | 'document' | 'presentation' | 'code' | 'other'> = {
      // Spreadsheet
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'spreadsheet',
      'application/vnd.ms-excel': 'spreadsheet',
      'text/csv': 'spreadsheet',
      // Document
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'document',
      'application/msword': 'document',
      'application/pdf': 'document',
      'text/plain': 'document',
      'text/markdown': 'document',
      // Presentation
      'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'presentation',
      'application/vnd.ms-powerpoint': 'presentation',
      // Code/Data
      'application/json': 'code',
    }

    return attachments
      .filter(att => {
        const category = documentTypeMap[att.type]
        const isText = att.type.startsWith('text/')
        const isImage = att.type.startsWith('image/')
        const shouldInclude = category || isText
        log.debug({ name: att.name, type: att.type, category: category || 'none', isText, isImage, included: shouldInclude }, 'Filtering attachment')
        return shouldInclude
      })
      .map(att => ({
        name: att.name,
        type: att.type,
        data: att.data, // base64 data URL
        category: documentTypeMap[att.type] || (att.type.startsWith('text/') ? 'code' : 'other'),
      }))
  }

  /**
   * 生成文件处理指令
   */
  private generateFileInstruction(filePaths: string[], fileCategories: Map<string, 'spreadsheet' | 'document' | 'presentation' | 'code' | 'other'>): string {
    const filesByCategory = new Map<string, string[]>()

    // 按类别分组
    for (const path of filePaths) {
      const category = fileCategories.get(path) || 'other'
      const list = filesByCategory.get(category) || []
      list.push(path)
      filesByCategory.set(category, list)
    }

    // 生成各类别的处理指南
    const categoryInstructions: string[] = []

    if (filesByCategory.has('spreadsheet')) {
      const files = filesByCategory.get('spreadsheet')!
      categoryInstructions.push(`
### 📊 SPREADSHEET FILES (Excel/CSV) - PROCESS THESE FIRST
Files: ${files.join(', ')}

⚠️ CRITICAL: Excel (.xlsx) files are BINARY and CANNOT be read directly with the Read tool!

YOUR FIRST ACTION MUST BE:
1. Write a Python or Node.js script to read the Excel file
2. Use the script to analyze the data: columns, rows, headers, data types
3. Print the data to stdout so you can see the content
4. THEN perform the user's requested operation on this data

**For Excel files (.xlsx), use Python with pandas:**
\`\`\`python
import pandas as pd
import os

file_path = "${files.find(f => f.endsWith('.xlsx')) || files[0]}"
df = pd.read_excel(file_path)
print("Columns:", df.columns.tolist())
print("\nFirst 10 rows:")
print(df.head(10).to_string())
print(f"\nTotal rows: {len(df)}")
\`\`\`

**For CSV files, you can use Read tool directly.**

⛔ DO NOT use Read tool on .xlsx files - they are binary!
⛔ DO NOT search the codebase for data processing logic
⛔ DO NOT write scripts to generate fake data
✅ USE the actual data in these files`)
    }

    if (filesByCategory.has('document')) {
      const files = filesByCategory.get('document')!
      categoryInstructions.push(`
### 📝 DOCUMENT FILES (Word/PDF/Text) - READ THESE FIRST
Files: ${files.join(', ')}

YOUR FIRST ACTION MUST BE:
1. Use Read tool to read EACH document
2. Extract all content and instructions
3. Follow any instructions in the document
4. THEN respond based on the document content`)
    }

    if (filesByCategory.has('presentation')) {
      const files = filesByCategory.get('presentation')!
      categoryInstructions.push(`
### 🎯 PRESENTATION FILES (PowerPoint)
Files: ${files.join(', ')}

YOUR FIRST ACTION MUST BE:
1. Use Read tool to read the presentation
2. Extract slide content and structure
3. THEN summarize or transform as requested`)
    }

    if (filesByCategory.has('code')) {
      const files = filesByCategory.get('code')!
      categoryInstructions.push(`
### 💻 CODE/DATA FILES
Files: ${files.join(', ')}

YOUR FIRST ACTION MUST BE:
1. Use Read tool to read EACH file
2. Parse according to file format
3. THEN process or transform as requested`)
    }

    return `## 📎 ATTACHED FILES - MANDATORY FIRST STEP

**⛔ STOP! DO NOT PROCEED UNTIL YOU HAVE READ ALL ATTACHED FILES ⛔**

The user has uploaded ${filePaths.length} file(s) that you MUST process:

${categoryInstructions.join('\n---\n')}

---

## 🚫 FORBIDDEN ACTIONS

⛔ DO NOT search the codebase for existing implementations
⛔ DO NOT explore unrelated directories
⛔ DO NOT assume what the file contains - READ IT FIRST
⛔ DO NOT generate fake or sample data

## ✅ REQUIRED ACTIONS

✅ READ each attached file using the Read tool
✅ ANALYZE the actual content
✅ PERFORM the user's request ON THESE FILES
✅ SAVE results to the workspace directory

---

## User's Request

(Execute this AFTER reading all attached files):

`
  }

  /**
   * 流式执行 —— 核心方法
   *
   * Claude SDK 内部完成多轮 tool-use loop（maxTurns: 200），
   * 工具调用、执行、回传全部由 SDK 闭环处理。
   */
  async *streamExecution(
    prompt: string,
    sessionId?: string,
    attachments?: MessageAttachment[],
    conversation?: ConversationMessage[],
    streamOptions?: StreamExecutionOptions
  ): AsyncIterable<AgentMessage> {
    const effectiveSessionId = sessionId || `session_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`
    const storageRootId = streamOptions?.taskId || effectiveSessionId
    const baseWorkDir = streamOptions?.workDir || this.config.workDir
    const startedAt = Date.now()
    const observedArtifacts = new Set<string>()
    let sawDone = false
    let sawError = false
    let warningCount = 0
    let errorCount = 0
    let providerMetadata: {
      subtype?: string
      durationMs?: number
      totalCostUsd?: number
    } = {}

    // 调试日志：输出当前使用的配置
    const maskedApiKey = this.config.provider.apiKey
      ? `${this.config.provider.apiKey.slice(0, 8)}...${this.config.provider.apiKey.slice(-4)}`
      : '(empty)'
    log.debug({
      provider: this.config.provider.provider,
      model: this.config.provider.model,
      baseUrl: this.config.provider.baseUrl,
      apiKey: maskedApiKey,
      workDir: baseWorkDir,
    }, 'streamExecution called')

    const agent = this.createAgent(this.config.provider)
    const abortController = new AbortController()

    this.runningSessions.set(effectiveSessionId, { agent, abortController })

    // 转换 attachments 为 images
    const images = this.convertAttachmentsToImages(attachments)
    log.debug({ totalAttachments: attachments?.length || 0, images: images.length }, 'Received attachments')

    // 提取文件附件并保存到磁盘
    const fileAttachments = this.extractFileAttachments(attachments)
    log.debug({ count: fileAttachments.length }, 'Extracted file attachments')
    if (fileAttachments.length > 0) {
      log.debug({ files: fileAttachments.map(f => `${f.name} (${f.type})`) }, 'File attachments')
    }

    const savedFilePaths: string[] = []
    const fileCategories = new Map<string, 'spreadsheet' | 'document' | 'presentation' | 'code' | 'other'>()

    // 计算会话工作目录 (与 claude.ts 保持一致)
    const sessionCwd = getSessionWorkDir(baseWorkDir, storageRootId)
    log.debug({ sessionCwd }, 'Session work directory')
    const attachmentDir = streamOptions?.taskId
      ? resolveTaskInputsDir(baseWorkDir, streamOptions.taskId)
      : sessionCwd

    if (fileAttachments.length > 0) {
      await this.ensureDir(attachmentDir)

      for (const file of fileAttachments) {
        try {
          // 从 base64 data URL 中提取实际数据
          const base64Data = file.data.split(',')[1] || file.data
          const buffer = Buffer.from(base64Data, 'base64')

          // 保存到工作目录
          const filePath = join(attachmentDir, file.name)
          await writeFile(filePath, buffer)
          savedFilePaths.push(filePath)
          fileCategories.set(filePath, file.category)
          log.debug({ filePath, category: file.category, bytes: buffer.length }, 'Saved attachment')
        } catch (err) {
          log.error({ err, fileName: file.name }, 'Failed to save attachment')
        }
      }
    }

    // 如果有文件附件，在 prompt 中添加强制的文件处理指令
    let enhancedPrompt = prompt
    if (savedFilePaths.length > 0) {
      const fileInstruction = this.generateFileInstruction(savedFilePaths, fileCategories)
      enhancedPrompt = `${fileInstruction}\n\n${prompt}`
      log.debug({ fileCount: savedFilePaths.length }, 'Enhanced prompt with file instructions')
    }

    // 如果有文件附件，使用会话工作目录作为系统提示的 workDir
    // 这样 Agent 会知道文件实际保存在会话目录中
    const systemPromptWorkDir = savedFilePaths.length > 0 ? sessionCwd : baseWorkDir

    // 转换 conversation 为 ConversationMessage 格式
    const conversationMessages = conversation?.map(msg => ({
      role: msg.role,
      content: msg.content,
    }))

    // --- Intent classification (Task 5.1) ---
    const classification = intentClassifier.classify(enhancedPrompt)
    log.debug({ intent: classification.primaryIntent, confidence: classification.confidence, complexity: classification.complexity }, 'Intent classified')

    // --- Context management (Tasks 5.3–5.5) ---
    const memoryStore = new MemoryStore(baseWorkDir, storageRootId)
    const globalKnowledgeDir = join(resolveArclayHome(), 'knowledge-notes')
    const knowledgeNotesStore = new KnowledgeNotesStore(globalKnowledgeDir)
    const contextManager = new ContextManager(baseWorkDir, memoryStore, storageRootId, knowledgeNotesStore)
    await contextManager.load(effectiveSessionId)
    const contextPrompt = await contextManager.buildContextPrompt()

    // Build system prompt, injecting session context when available
    let systemPrompt =
      streamOptions?.systemPrompt ||
      this.config.systemPrompt ||
      getDefaultSystemPrompt(systemPromptWorkDir)
    if (contextPrompt) {
      systemPrompt = `${systemPrompt}\n\n${contextPrompt}`
    }

    const options: AgentRunOptions = {
      systemPrompt,
      signal: abortController.signal,
      sessionId: effectiveSessionId,
      taskId: streamOptions?.taskId || effectiveSessionId, // 确保 ClaudeProvider 使用同一会话目录
      cwd: baseWorkDir, // 传入基础 workDir，让 ClaudeProvider 自己计算 sessionCwd
      skillsConfig: this.config.skills,
      mcpConfig: this.config.mcp,
      sandbox: this.config.sandbox,
      images: images.length > 0 ? images : undefined,
      conversation: conversationMessages,
      contextManager,
      complexityHint: classification.complexity,
      plan: streamOptions?.plan,
    }

    const historyScope = {
      sessionId: effectiveSessionId,
      taskId: streamOptions?.taskId || effectiveSessionId,
      turnId: streamOptions?.turnId || null,
      runId: effectiveSessionId,
    }
    const historyLogger = new HistoryLogger(memoryStore, historyScope)

    try {
      for await (const message of agent.stream(enhancedPrompt, options)) {
        if (message.type === 'tool_result') {
          // Prefer structured artifacts metadata
          if (message.artifacts && Array.isArray(message.artifacts)) {
            for (const artifactPath of message.artifacts) {
              if (typeof artifactPath === 'string' && artifactPath.length > 0) {
                observedArtifacts.add(artifactPath)
              }
            }
          } else {
            // Fallback to parsing legacy toolOutput string
            for (const artifactPath of collectArtifactsFromToolOutput(message.toolOutput)) {
              observedArtifacts.add(artifactPath)
            }
          }
        }
        if (message.type === 'done') {
          sawDone = true
          providerMetadata = {
            subtype: (message as any).providerResultSubtype,
            durationMs: (message as any).providerDurationMs,
            totalCostUsd: (message as any).providerTotalCostUsd,
          }
        }
        if (message.type === 'error') {
          sawError = true
          errorCount++
        }
        if (message.type === 'text' && message.isTemporary) {
          // In our harness, temporary text messages from assistant often represent warnings
          if (message.content?.toLowerCase().includes('warning')) {
            warningCount++
          }
        }
        yield message
        // Record execution trace to JSONL (non-blocking, errors logged not thrown)
        historyLogger.logAgentMessage(message).catch(() => {})
      }
    } catch (error) {
      sawError = true
      yield {
        id: `msg_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`,
        type: 'error',
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
        timestamp: Date.now(),
      }
    } finally {
      // Persist session context after execution
      await contextManager.save(effectiveSessionId)
      await historyLogger.logCompletion()
      // Generate daily memory from execution history
      try {
        const dailySummary = await generateDailySummary(effectiveSessionId, memoryStore, {
          fallbackGoal: streamOptions?.plan?.goal || prompt,
        })
        if (dailySummary) {
          const session = contextManager.getSession()
          if (session) {
            const existing = session.conversationSummary
            session.conversationSummary = existing
              ? `${existing}\n\n${dailySummary}`
              : dailySummary
            await contextManager.save(effectiveSessionId)
          }
        }
      } catch (err) {
        log.warn({ err }, 'Failed to generate daily memory')
      }
      if (streamOptions?.taskId && (sawDone || sawError)) {
        try {
          await appendTaskMetricsRecord({
            taskId: streamOptions.taskId,
            runId: effectiveSessionId,
            success: sawDone && !sawError,
            durationMs: Date.now() - startedAt,
            model: this.config.provider.model,
            provider: this.config.provider.provider,
            artifacts: Array.from(observedArtifacts),
            timestamp: new Date(),
            providerResultSubtype: providerMetadata.subtype,
            providerDurationMs: providerMetadata.durationMs,
            providerTotalCostUsd: providerMetadata.totalCostUsd,
            warningCount,
            errorCount,
          })
        } catch (err) {
          log.warn({ err }, 'Failed to append metrics record')
        }
      }
      this.runningSessions.delete(effectiveSessionId)
    }
  }

  abort(sessionId?: string): boolean {
    if (sessionId) {
      const running = this.runningSessions.get(sessionId)
      if (running) {
        running.abortController.abort()
        this.runningSessions.delete(sessionId)
        return true
      }
    }
    for (const [, running] of this.runningSessions) {
      running.abortController.abort()
    }
    this.runningSessions.clear()
    return true
  }

  getTools(): ToolDefinition[] {
    return []
  }

  /**
   * 确保目录存在
   */
  private async ensureDir(dir: string): Promise<void> {
    try {
      await mkdir(dir, { recursive: true })
    } catch (err) {
      // 目录已存在或创建失败
      log.error({ err, dir }, 'Failed to create directory')
    }
  }
}

export function createAgentService(
  providerConfig: ProviderConfig,
  workDir: string,
  skills?: SkillsConfig,
  mcp?: McpConfig,
  sandbox?: SandboxConfig
): AgentService {
  return new AgentService({
    provider: providerConfig,
    workDir,
    skills,
    mcp,
    sandbox,
  })
}
