import type { AgentMessage, MessageAttachment, DeliverableType } from '@shared-types'
import type { ConversationMessage } from '../core/agent/interface'
import type { TaskPlan } from '../types/agent-new'
import { isBrowserAutomationIntent } from './browser-intent'
import { buildExecutionPrompt } from './plan-execution'
import type { RunExecutionSessionInput } from './execution-session'
import type { ExecutionCompletionSummary } from './execution-completion'
import { resolveTurnArtifactsDir, resolveTurnWorkspaceDir } from './workspace-layout'

const DEFAULT_MAX_RUNTIME_REPAIR_ATTEMPTS = 1

type ExecutionEntryPassthrough = Omit<
  RunExecutionSessionInput,
  | 'promptText'
  | 'executionPrompt'
  | 'executionSummary'
  | 'runtimeGateRequired'
  | 'browserAutomationIntent'
  | 'maxExecutionAttempts'
  | 'contextLogLines'
  | 'streamExecution'
  | 'processExecutionMessage'
>

export interface ResolveExecutionEntryInput extends ExecutionEntryPassthrough {
  prompt: unknown
  attachments?: MessageAttachment[]
  providerName?: string
  providerModel?: string
  sandboxEnabled?: boolean
  runtimeMcpServers?: Record<string, unknown> | null
  settingsMcpServers?: Record<string, unknown> | null
  maxRuntimeRepairAttempts?: number
  formatPlanForExecution: (plan: TaskPlan, workDir: string) => string
  streamAgentExecution: (
    prompt: string,
    sessionId: string,
    attachments?: MessageAttachment[],
    conversation?: ConversationMessage[],
    context?: { workDir: string; taskId: string; plan?: TaskPlan; turnId?: string }
  ) => AsyncIterable<AgentMessage>
  capturePendingInteraction: (
    message: AgentMessage,
    context: { taskId?: string; runId?: string; providerSessionId?: string }
  ) => void
  processExecutionStreamMessage: (input: {
    message: AgentMessage
    executionSummary: ExecutionCompletionSummary
    browserAutomationIntent: boolean
    progressPath: string
    appendProgressEntry: (
      progressPath: string,
      lines: string[]
    ) => Promise<void>
  }) => Promise<{
    executionFailed: boolean
    executionFailureReason: string | null
    shouldForward: boolean
  }>
}

function createExecutionSummary(): ExecutionCompletionSummary {
  return {
    toolUseCount: 0,
    toolResultCount: 0,
    meaningfulToolUseCount: 0,
    browserToolUseCount: 0,
    browserNavigationCount: 0,
    browserInteractionCount: 0,
    browserSnapshotCount: 0,
    browserScreenshotCount: 0,
    browserEvalCount: 0,
    assistantTextCount: 0,
    meaningfulAssistantTextCount: 0,
    preambleAssistantTextCount: 0,
    resultMessageCount: 0,
    latestTodoSnapshot: null,
    pendingInteractionCount: 0,
    blockerCandidate: null,
    blockedArtifactPath: null,
    providerResultSubtype: null,
    providerStopReason: null,
  }
}

function stripUrls(text: string): string {
  return text.replace(/https?:\/\/\S+/gi, ' ')
}

function isRuntimeRunIntentLegacy(promptText: string, plan: TaskPlan): boolean {
  if (isBrowserAutomationIntent(promptText, plan)) {
    return false
  }

  const corpus = stripUrls(
    [promptText, plan.goal, ...plan.steps.map((step) => step.description)].join('\n')
  ).toLowerCase()
  const runHint = /运行|启动|可跑起来|本地启动|\brun\b|\bstart\b|\bserve\b|\bpreview\b|\bdev\s+server\b/.test(corpus)
  const targetHint = /项目|仓库|前端|后端|服务|页面|界面|应用|\bproject\b|\brepo(?:sitory)?\b|\bfrontend\b|\bbackend\b|\bserver\b|\bservice\b|\bweb\b|\bapp\b|\bapi\b/.test(corpus)
  return runHint && targetHint
}

function shouldEnableRuntimeGate(plan: TaskPlan): boolean {
  // 1. Explicit type takes precedence
  if (plan.deliverableType) {
    return plan.deliverableType === 'local_service' ||
           plan.deliverableType === 'deployed_service'
  }

  // 2. Fallback to legacy keyword detection (backward compatibility)
  return false // Will be set by caller using legacy function
}

function validateDeliverableType(plan: TaskPlan): {
  valid: boolean
  correctedType?: DeliverableType
  reason?: string
} {
  if (!plan.deliverableType) {
    return {
      valid: false,
      correctedType: 'unknown',
      reason: 'Agent did not specify deliverable type'
    }
  }

  const corpus = [plan.goal, plan.notes, ...plan.steps.map(s => s.description)]
    .filter(Boolean)
    .join('\n')
    .toLowerCase()

  // Rule 1: Contains "HTML 文件" but classified as local_service
  if (plan.deliverableType === 'local_service' &&
      /html\s*文件|静态.*html|单.*html/.test(corpus) &&
      !/npm|yarn|pnpm|webpack|vite|server/.test(corpus)) {
    return {
      valid: false,
      correctedType: 'static_files',
      reason: 'Detected static HTML file generation, corrected to static_files'
    }
  }

  // Rule 2: Contains "启动服务" but classified as static_files
  if (plan.deliverableType === 'static_files' &&
      /启动.*服务|npm.*dev|本地.*服务器/.test(corpus)) {
    return {
      valid: false,
      correctedType: 'local_service',
      reason: 'Detected service startup requirement, corrected to local_service'
    }
  }

  return { valid: true }
}

function collectConfiguredServerNames(record?: Record<string, unknown> | null): string[] {
  if (!record) return []
  return Object.keys(record).filter((name) => name.trim().length > 0)
}

function hasBrowserAutomationServer(serverNames: string[]): boolean {
  return serverNames.some((name) => /chrome-devtools|playwright|browser|devtools/i.test(name))
}

function buildExecutionContextLogLines(input: {
  promptText: string
  plan: TaskPlan
  providerName?: string
  providerModel?: string
  sandboxEnabled?: boolean
  runtimeMcpServers?: Record<string, unknown> | null
  settingsMcpServers?: Record<string, unknown> | null
  now?: () => Date
}): string[] {
  const runtimeMcpServers = collectConfiguredServerNames(input.runtimeMcpServers)
  const settingsMcpServers = collectConfiguredServerNames(input.settingsMcpServers)
  const browserAutomationIntent = isBrowserAutomationIntent(input.promptText, input.plan)
  const providerName = input.providerName || '(unknown)'
  const providerModel = input.providerModel || '(unknown)'
  const browserAutomationRuntimeReady = hasBrowserAutomationServer(runtimeMcpServers)

  const lines = [
    `### Execution Context (${(input.now || (() => new Date()))().toISOString()})`,
    `- Provider: ${providerName} / ${providerModel}`,
    `- Browser Automation Intent: ${browserAutomationIntent ? 'yes' : 'no'}`,
    `- Runtime MCP Servers: ${runtimeMcpServers.length > 0 ? runtimeMcpServers.join(', ') : '(none)'}`,
    `- Settings MCP Servers: ${settingsMcpServers.length > 0 ? settingsMcpServers.join(', ') : '(none)'}`,
    `- Sandbox Enabled: ${input.sandboxEnabled === true ? 'yes' : 'no'}`,
  ]

  if (browserAutomationIntent && !browserAutomationRuntimeReady) {
    lines.push('- Warning: Browser automation intent detected, but no browser MCP server is present in the runtime config.')
  }

  return lines
}

function buildArtifactLayoutInstruction(input: {
  executionWorkspaceDir: string
  taskId: string
  activeTurn: ExecutionEntryPassthrough['activeTurn']
}): string {
  if (!input.activeTurn?.id) return ''

  const turnDir = resolveTurnWorkspaceDir(
    input.executionWorkspaceDir,
    input.taskId,
    input.activeTurn.id
  )
  const artifactsDir = resolveTurnArtifactsDir(
    input.executionWorkspaceDir,
    input.taskId,
    input.activeTurn.id
  )
  const finalDir = `${artifactsDir}/final`
  const intermediateDir = `${artifactsDir}/intermediate`
  const scratchDir = `${turnDir}/scratch`

  return `
## CRITICAL: Turn Artifact Layout

Use the current turn directory for all execution outputs:
- Final user deliverables MUST go under: ${finalDir}
- Intermediate drafts that should be preserved MUST go under: ${intermediateDir}
- Temporary helper scripts or scratch files MUST go under: ${scratchDir}
- Do NOT leave helper scripts, temporary files, or final deliverables in the task root: ${input.executionWorkspaceDir}
`
}

export function resolveExecutionEntry(
  input: ResolveExecutionEntryInput
): RunExecutionSessionInput {
  const {
    prompt,
    attachments,
    providerName,
    providerModel,
    sandboxEnabled,
    runtimeMcpServers,
    settingsMcpServers,
    maxRuntimeRepairAttempts: maxRuntimeRepairAttemptsInput,
    formatPlanForExecution,
    streamAgentExecution,
    capturePendingInteraction,
    processExecutionStreamMessage,
    ...passthrough
  } = input
  const promptText = typeof prompt === 'string' ? prompt : ''
  const executionSummary = createExecutionSummary()

  // Validate and correct deliverable type
  const validation = validateDeliverableType(passthrough.plan)
  if (!validation.valid && validation.correctedType) {
    console.warn(`[ExecutionEntry] ${validation.reason}`)
    passthrough.plan.deliverableType = validation.correctedType
  }

  // Determine runtime gate requirement
  let runtimeGateRequired = shouldEnableRuntimeGate(passthrough.plan)
  if (!passthrough.plan.deliverableType) {
    // Fallback to legacy detection if no deliverable type
    runtimeGateRequired = isRuntimeRunIntentLegacy(promptText, passthrough.plan)
  }

  const baseExecutionPrompt = buildExecutionPrompt(
    passthrough.plan,
    promptText,
    passthrough.executionWorkspaceDir,
    formatPlanForExecution
  )
  const artifactLayoutInstruction = buildArtifactLayoutInstruction({
    executionWorkspaceDir: passthrough.executionWorkspaceDir,
    taskId: passthrough.executionTaskId,
    activeTurn: passthrough.activeTurn,
  })
  const executionPrompt = artifactLayoutInstruction
    ? `${baseExecutionPrompt}\n\n${artifactLayoutInstruction}`
    : baseExecutionPrompt
  const browserAutomationIntent = isBrowserAutomationIntent(promptText, passthrough.plan)
  const maxRuntimeRepairAttempts = maxRuntimeRepairAttemptsInput ?? DEFAULT_MAX_RUNTIME_REPAIR_ATTEMPTS
  const maxExecutionAttempts = runtimeGateRequired ? maxRuntimeRepairAttempts + 1 : 1

  return {
    ...passthrough,
    promptText,
    executionPrompt,
    executionSummary,
    runtimeGateRequired,
    browserAutomationIntent,
    maxExecutionAttempts,
    contextLogLines: buildExecutionContextLogLines({
      promptText,
      plan: passthrough.plan,
      providerName,
      providerModel,
      sandboxEnabled,
      runtimeMcpServers,
      settingsMcpServers,
      now: passthrough.now,
    }),
    streamExecution: (promptForAttempt) => streamAgentExecution(
      promptForAttempt,
      passthrough.runId,
      attachments,
      undefined,
      {
        workDir: passthrough.effectiveWorkDir,
        taskId: passthrough.executionTaskId,
        turnId: passthrough.activeTurn?.id,
        plan: passthrough.plan,
      }
    ),
    processExecutionMessage: async (message, observation) => {
      capturePendingInteraction(message, {
        taskId: passthrough.executionTaskId,
        runId: passthrough.runId,
        providerSessionId: passthrough.runId,
      })
      return processExecutionStreamMessage({
        message,
        executionSummary,
        browserAutomationIntent,
        progressPath: passthrough.progressPath,
        appendProgressEntry: passthrough.appendProgressEntry,
      })
    },
  }
}
