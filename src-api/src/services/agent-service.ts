/**
 * Agent Service - 编排 Agent 执行
 *
 * 架构（easywork 模式）：
 *   所有 provider 统一通过 Claude Agent SDK 执行。
 *   非 Anthropic 原生 API（OpenRouter、火山引擎等）通过设置 ANTHROPIC_BASE_URL 透传。
 *   SDK 内部完成多轮 tool-use loop，无需手动管理循环。
 *
 * 工作流：
 *   用户输入 → API /agent → AgentService → ClaudeAgent → Claude Agent SDK → SSE 流式返回
 */

import { join } from 'path'
import { writeFile, mkdir } from 'fs/promises'
import type {
  AgentMessage,
  ProviderConfig,
  ToolDefinition,
  MessageAttachment,
} from '@shared-types'
import type { IAgent, AgentRunOptions } from '../core/agent/interface'
import type { SkillsConfig, McpConfig, SandboxConfig, ImageAttachment } from '../core/agent/types'
import { agentRegistry } from '../core/agent/registry'
import { getDefaultSystemPrompt } from '../core/agent/system-prompt'
import { ContextManager } from './context-manager'
import { intentClassifier } from './intent-classifier'

/**
 * Generate session work directory path (must match claude.ts logic)
 *
 * 注意：此函数必须与 claude.ts 中的 getSessionWorkDir 保持逻辑一致
 * 以确保文件保存路径和执行路径相同
 */
function getSessionWorkDir(baseWorkDir: string, sessionId: string): string {
  // Match the logic in claude.ts getSessionWorkDir
  // ClaudeProvider 使用 taskId 作为文件夹名称（当提供 taskId 时）
  // 见 claude.ts line 484-485: folderName = taskId
  const sessionsDir = join(baseWorkDir, 'sessions')
  return join(sessionsDir, sessionId)
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
  systemPrompt?: string
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
      console.warn(
        `[AgentService] Provider "${requestedType}" not registered, falling back to "${plugin.metadata.type}"`
      )
    }

    console.log('[AgentService] Creating agent with config:', {
      provider: requestedType,
      model: agentConfig.model,
      baseUrl: agentConfig.baseUrl,
      apiKey: agentConfig.apiKey ? `${agentConfig.apiKey.slice(0, 8)}...${agentConfig.apiKey.slice(-4)}` : '(empty)',
    })
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
        console.log(`[AgentService] Filtering attachment: ${att.name} (${att.type}) - category: ${category || 'none'}, isText: ${isText}, isImage: ${isImage}, included: ${shouldInclude}`)
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
    conversation?: { role: 'user' | 'assistant'; content: string }[],
    streamOptions?: StreamExecutionOptions
  ): AsyncIterable<AgentMessage> {
    const effectiveSessionId = sessionId || `session_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`
    const baseWorkDir = streamOptions?.workDir || this.config.workDir

    // 调试日志：输出当前使用的配置
    const maskedApiKey = this.config.provider.apiKey
      ? `${this.config.provider.apiKey.slice(0, 8)}...${this.config.provider.apiKey.slice(-4)}`
      : '(empty)'
    console.log(`[AgentService] streamExecution called with config:`, {
      provider: this.config.provider.provider,
      model: this.config.provider.model,
      baseUrl: this.config.provider.baseUrl,
      apiKey: maskedApiKey,
      workDir: baseWorkDir,
    })

    const agent = this.createAgent(this.config.provider)
    const abortController = new AbortController()

    this.runningSessions.set(effectiveSessionId, { agent, abortController })

    // 转换 attachments 为 images
    const images = this.convertAttachmentsToImages(attachments)
    console.log(`[AgentService] Received ${attachments?.length || 0} attachments, ${images.length} images`)

    // 提取文件附件并保存到磁盘
    const fileAttachments = this.extractFileAttachments(attachments)
    console.log(`[AgentService] Extracted ${fileAttachments.length} file attachments`)
    if (fileAttachments.length > 0) {
      console.log(`[AgentService] File attachments: ${fileAttachments.map(f => `${f.name} (${f.type})`).join(', ')}`)
    }

    const savedFilePaths: string[] = []
    const fileCategories = new Map<string, 'spreadsheet' | 'document' | 'presentation' | 'code' | 'other'>()

    // 计算会话工作目录 (与 claude.ts 保持一致)
    const sessionCwd = getSessionWorkDir(baseWorkDir, effectiveSessionId)
    console.log(`[AgentService] Session work directory: ${sessionCwd}`)

    if (fileAttachments.length > 0) {
      await this.ensureDir(sessionCwd)

      for (const file of fileAttachments) {
        try {
          // 从 base64 data URL 中提取实际数据
          const base64Data = file.data.split(',')[1] || file.data
          const buffer = Buffer.from(base64Data, 'base64')

          // 保存到工作目录
          const filePath = join(sessionCwd, file.name)
          await writeFile(filePath, buffer)
          savedFilePaths.push(filePath)
          fileCategories.set(filePath, file.category)
          console.log(`[AgentService] Saved ${file.category} attachment: ${filePath} (${buffer.length} bytes)`)
        } catch (err) {
          console.error(`[AgentService] Failed to save attachment ${file.name}:`, err)
        }
      }
    }

    // 如果有文件附件，在 prompt 中添加强制的文件处理指令
    let enhancedPrompt = prompt
    if (savedFilePaths.length > 0) {
      const fileInstruction = this.generateFileInstruction(savedFilePaths, fileCategories)
      enhancedPrompt = `${fileInstruction}\n\n${prompt}`
      console.log(`[AgentService] Enhanced prompt with file instructions for ${savedFilePaths.length} file(s)`)
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
    console.log(`[AgentService] Intent: ${classification.primaryIntent} (confidence=${classification.confidence.toFixed(2)}, complexity=${classification.complexity})`)

    // --- Context management (Tasks 5.3–5.5) ---
    const contextManager = new ContextManager(baseWorkDir)
    await contextManager.load(effectiveSessionId)
    const contextPrompt = contextManager.buildContextPrompt()

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
    }

    try {
      for await (const message of agent.stream(enhancedPrompt, options)) {
        yield message
      }
    } catch (error) {
      yield {
        id: `msg_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`,
        type: 'error',
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
        timestamp: Date.now(),
      }
    } finally {
      // Persist session context after execution
      await contextManager.save(effectiveSessionId)
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
      console.error(`[AgentService] Failed to create directory ${dir}:`, err)
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
