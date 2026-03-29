import type { AgentMessage, TaskPlan } from '@shared-types'
import type { TurnRecord } from '../types/turn-runtime'
import type { SaveTurnDetailInput, TurnDetailArtifactRecord } from './turn-detail-store'

function isSuccessfulToolResult(output?: string): boolean {
  if (!output) return false
  const normalized = output.toLowerCase()
  return !(
    normalized.includes('enoent') ||
    normalized.includes('no such file or directory') ||
    normalized.includes('permission denied') ||
    normalized.includes('error:') ||
    normalized.startsWith('failed')
  )
}

function getArtifactType(filePath: string): string {
  const lower = filePath.toLowerCase()
  if (lower.endsWith('.pdf')) return 'pdf'
  if (lower.endsWith('.md')) return 'markdown'
  if (lower.endsWith('.html') || lower.endsWith('.htm')) return 'html'
  if (lower.endsWith('.png') || lower.endsWith('.jpg') || lower.endsWith('.jpeg') || lower.endsWith('.gif') || lower.endsWith('.webp')) return 'image'
  if (lower.endsWith('.json')) return 'json'
  if (lower.endsWith('.csv') || lower.endsWith('.tsv')) return 'csv'
  if (lower.endsWith('.ts') || lower.endsWith('.tsx') || lower.endsWith('.js') || lower.endsWith('.jsx')) return 'code'
  return 'text'
}

function dedupeArtifacts(artifacts: TurnDetailArtifactRecord[]): TurnDetailArtifactRecord[] {
  const seen = new Set<string>()
  return artifacts.filter((artifact) => {
    if (!artifact.path || seen.has(artifact.path)) return false
    seen.add(artifact.path)
    return true
  })
}

function extractPlanSnapshot(messages: AgentMessage[], fallbackPlan?: TaskPlan | null): TaskPlan | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]
    if (message.type === 'plan' && message.plan) {
      return message.plan as TaskPlan
    }
  }
  return fallbackPlan || null
}

function isSubstantiveAssistantOutput(content: string): boolean {
  const trimmed = content.trim()
  if (!trimmed) return false

  return (
    trimmed.length >= 80 ||
    /[\r\n]/.test(trimmed) ||
    /```/.test(trimmed) ||
    /\|\s*.+\s*\|/.test(trimmed) ||
    /https?:\/\//.test(trimmed) ||
    /(?:^|\n)\s*(?:[-*]|\d+\.)\s+/.test(trimmed)
  )
}

function extractOutputText(messages: AgentMessage[]): string | null {
  let fallbackText: string | null = null

  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]
    if ((message.type === 'result' || message.type === 'direct_answer') && message.content?.trim()) {
      return message.content.trim()
    }
    if (message.type === 'text' && message.role !== 'user' && !message.isTemporary && message.content?.trim()) {
      const text = message.content.trim()
      fallbackText ??= text
      if (isSubstantiveAssistantOutput(text)) {
        return text
      }
    }
  }

  return fallbackText
}

function extractArtifacts(messages: AgentMessage[]): TurnDetailArtifactRecord[] {
  const pendingPaths = new Map<string, string>()
  const artifacts: TurnDetailArtifactRecord[] = []

  for (const message of messages) {
    if (message.type === 'tool_use' && message.toolUseId && message.toolName === 'Write') {
      const pathValue = message.toolInput?.file_path ?? message.toolInput?.path
      if (typeof pathValue === 'string' && pathValue.trim()) {
        pendingPaths.set(message.toolUseId, pathValue.trim())
      }
      continue
    }

    if (message.type === 'tool_result' && message.toolUseId && isSuccessfulToolResult(message.toolOutput)) {
      const filePath = pendingPaths.get(message.toolUseId)
      if (!filePath) continue
      artifacts.push({
        id: `artifact-${filePath.replace(/[^a-zA-Z0-9]/g, '-')}`,
        name: filePath.split(/[\\/]/).pop() || filePath,
        path: filePath,
        type: getArtifactType(filePath),
        mimeType: filePath.toLowerCase().endsWith('.pdf') ? 'application/pdf' : undefined,
      })
    }
  }

  return dedupeArtifacts(artifacts)
}

function buildSummaryText(turn: TurnRecord, outputText: string | null): string | null {
  const prompt = turn.prompt.trim()
  if (prompt) {
    return prompt.length > 120 ? `${prompt.slice(0, 120)}...` : prompt
  }
  if (outputText) {
    return outputText.length > 120 ? `${outputText.slice(0, 120)}...` : outputText
  }
  return null
}

export function buildTurnDetailSnapshot(input: {
  taskId: string
  turn: TurnRecord
  messages: AgentMessage[]
  fallbackPlan?: TaskPlan | null
}): SaveTurnDetailInput {
  const outputText = extractOutputText(input.messages)
  return {
    taskId: input.taskId,
    turn: input.turn,
    summaryText: buildSummaryText(input.turn, outputText),
    planSnapshot: extractPlanSnapshot(input.messages, input.fallbackPlan),
    outputText,
    artifacts: extractArtifacts(input.messages),
  }
}
