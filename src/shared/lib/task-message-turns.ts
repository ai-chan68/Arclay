import type { AgentMessage, AgentTurnSnapshot, AgentTurnState, PendingQuestion, PermissionRequest, TaskPlan } from '@shared-types'
import {
  isPlaceholderAssistantResponse,
  isProcessAssistantResponse,
} from './task-state'

export interface ConversationTurn {
  id: string
  userMessage?: AgentMessage
  thinkingMessages: AgentMessage[]
  interactionMessages: AgentMessage[]
  runtimeStates: AgentTurnSnapshot[]
  pendingPermission?: PermissionRequest | null
  pendingQuestion?: PendingQuestion | null
  resultMessage?: AgentMessage
  planMessage?: AgentMessage
  isComplete: boolean
  plan?: TaskPlan
}

function hasMeaningfulTurnResult(turn: ConversationTurn): boolean {
  if (turn.thinkingMessages.length > 0) {
    return true
  }

  const content = turn.resultMessage?.content
  if (!content?.trim()) {
    return false
  }

  return !isPlaceholderAssistantResponse(content)
}

export function groupIntoTurns(messages: AgentMessage[], isRunning: boolean): ConversationTurn[] {
  const turns: ConversationTurn[] = []
  let currentTurn: ConversationTurn | null = null
  let accumulatedText = ''
  let resultIsExplicit = false
  let lastAssistantTextWasContinuous = false

  for (const msg of messages) {
    if (msg.type === 'session') continue

    if (msg.type === 'plan') {
      const planData = msg.plan as TaskPlan | undefined
      if (currentTurn) {
        currentTurn.planMessage = msg
        currentTurn.plan = planData
      } else {
        currentTurn = {
          id: msg.id,
          userMessage: undefined,
          thinkingMessages: [],
          interactionMessages: [],
          runtimeStates: [],
          pendingPermission: null,
          pendingQuestion: null,
          resultMessage: undefined,
          planMessage: msg,
          plan: planData,
          isComplete: true,
        }
        turns.push(currentTurn)
        currentTurn = null
      }
      continue
    }

    if (msg.type === 'user' || (msg.role === 'user' && msg.type === 'text')) {
      if (currentTurn) {
        turns.push(currentTurn)
      }
      currentTurn = {
        id: msg.id,
        userMessage: msg,
        thinkingMessages: [],
        interactionMessages: [],
        runtimeStates: [],
        pendingPermission: null,
        pendingQuestion: null,
        resultMessage: undefined,
        planMessage: undefined,
        isComplete: false,
      }
      accumulatedText = ''
      resultIsExplicit = false
      lastAssistantTextWasContinuous = false
      continue
    }

    if (!currentTurn) {
      currentTurn = {
        id: `turn_${Date.now()}`,
        userMessage: undefined,
        thinkingMessages: [],
        interactionMessages: [],
        runtimeStates: [],
        pendingPermission: null,
        pendingQuestion: null,
        resultMessage: undefined,
        planMessage: undefined,
        isComplete: false,
      }
    }

    if (msg.type === 'turn_state' && msg.turn) {
      currentTurn.runtimeStates.push(msg.turn)
      lastAssistantTextWasContinuous = false
    } else if (msg.type === 'permission_request' && msg.permission) {
      currentTurn.interactionMessages.push(msg)
      currentTurn.pendingPermission = msg.permission
      lastAssistantTextWasContinuous = false
    } else if (msg.type === 'clarification_request') {
      currentTurn.interactionMessages.push(msg)
      currentTurn.pendingQuestion = msg.clarification || msg.question || null
      lastAssistantTextWasContinuous = false
    } else if (msg.type === 'tool_use' || msg.type === 'tool_result') {
      currentTurn.thinkingMessages.push(msg)
      if (
        msg.type === 'tool_use' &&
        currentTurn.resultMessage &&
        !resultIsExplicit &&
        isPlaceholderAssistantResponse(currentTurn.resultMessage.content)
      ) {
        currentTurn.resultMessage = undefined
      }
      lastAssistantTextWasContinuous = false
    } else if (msg.type === 'result') {
      currentTurn.resultMessage = {
        ...msg,
        isTemporary: false,
      }
      resultIsExplicit = true
      currentTurn.isComplete = true
      lastAssistantTextWasContinuous = false
    } else if (msg.type === 'done') {
      if (currentTurn.resultMessage && !resultIsExplicit) {
        currentTurn.resultMessage = {
          ...currentTurn.resultMessage,
          isTemporary: false,
        }
      }
      currentTurn.isComplete = resultIsExplicit || hasMeaningfulTurnResult(currentTurn)
      lastAssistantTextWasContinuous = false
    } else if (msg.type === 'text' && msg.role === 'assistant') {
      accumulatedText = lastAssistantTextWasContinuous
        ? `${accumulatedText}${msg.content || ''}`
        : (msg.content || '')
      lastAssistantTextWasContinuous = true

      const nextTextBlock = accumulatedText
      if (!isProcessAssistantResponse(nextTextBlock) || !currentTurn.resultMessage) {
        currentTurn.resultMessage = {
          ...msg,
          content: nextTextBlock,
          isTemporary: !resultIsExplicit,
        }
      }
    } else if (msg.type === 'error') {
      currentTurn.thinkingMessages.push(msg)
      lastAssistantTextWasContinuous = false
    } else {
      lastAssistantTextWasContinuous = false
    }
  }

  if (currentTurn) {
    if (isRunning) {
      currentTurn.isComplete = false
    } else if (hasMeaningfulTurnResult(currentTurn)) {
      currentTurn.isComplete = true
      if (currentTurn.resultMessage && !resultIsExplicit) {
        currentTurn.resultMessage = {
          ...currentTurn.resultMessage,
          isTemporary: false,
        }
      }
    }
    turns.push(currentTurn)
  }

  return turns
}

export function getMessagesForTurn(turn: ConversationTurn): AgentMessage[] {
  const orderedMessages: AgentMessage[] = []
  if (turn.userMessage) orderedMessages.push(turn.userMessage)
  if (turn.planMessage) orderedMessages.push(turn.planMessage)
  orderedMessages.push(...turn.thinkingMessages)
  orderedMessages.push(...turn.interactionMessages)
  if (turn.resultMessage) orderedMessages.push(turn.resultMessage)
  return orderedMessages
}

export function getLatestRuntimeSnapshot(turn: ConversationTurn): AgentTurnSnapshot | null {
  if (turn.runtimeStates.length === 0) return null
  return turn.runtimeStates[turn.runtimeStates.length - 1] || null
}

export function getLatestRuntimeState(turn: ConversationTurn): AgentTurnState | null {
  return getLatestRuntimeSnapshot(turn)?.state || null
}
