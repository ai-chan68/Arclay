import type { AgentMessage, MessageAttachment } from '@shared-types'
import type { ConversationMessage } from '../core/agent/interface'
import type { TaskPlan } from '../types/agent-new'
import { isBrowserAutomationIntent } from './browser-intent'
import { buildExecutionPrompt } from './plan-execution'
import type { RunExecutionSessionInput } from './execution-session'
import type { ExecutionCompletionSummary } from './execution-completion'

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
    context?: { workDir: string; taskId: string; plan?: import('../types/agent-new').TaskPlan }
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

function isRuntimeRunIntent(promptText: string, plan: TaskPlan): boolean {
  const corpus = [promptText, plan.goal, ...plan.steps.map((step) => step.description)].join('\n').toLowerCase()
  if (isBrowserAutomationIntent(promptText, plan)) {
    return false
  }
  const runHint = /运行|启动|run|start|dev server|preview|可跑起来|本地启动|serve/.test(corpus)
  const targetHint = /项目|project|repo|repository|frontend|backend|server|service|web|app|页面|界面|api/.test(corpus)
  return runHint && targetHint
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
  const executionPrompt = buildExecutionPrompt(
    passthrough.plan,
    promptText,
    passthrough.executionWorkspaceDir,
    formatPlanForExecution
  )
  const runtimeGateRequired = isRuntimeRunIntent(promptText, passthrough.plan)
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
