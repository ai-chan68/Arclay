/**
 * Message list component
 * Styled to match the project design system
 * DeepSeek-style thinking process with collapsible sections
 */

import { useMemo } from 'react'
import type { AgentMessage, MessageRole } from 'shared-types'
import { MessageItem } from './MessageItem'
import { ThinkingProcess } from './ThinkingProcess'
import { Bot } from 'lucide-react'

interface MessageListProps {
  messages: AgentMessage[]
  isRunning?: boolean
}

/**
 * Conversation turn - groups messages belonging to one exchange
 */
interface ConversationTurn {
  id: string
  userMessage?: AgentMessage
  thinkingMessages: AgentMessage[]
  resultMessage?: AgentMessage
  isComplete: boolean
}

/**
 * Group messages into conversation turns
 * Each turn consists of: user message -> thinking process -> final result
 *
 * 支持动态合并连续的 assistant text 消息（用于 SSE 流式消息的增量更新）
 */
function groupIntoTurns(messages: AgentMessage[], isRunning: boolean): ConversationTurn[] {
  const turns: ConversationTurn[] = []
  let currentTurn: ConversationTurn | null = null

  for (const msg of messages) {
    // Skip session messages
    if (msg.type === 'session') continue

    // User message starts a new turn
    if (msg.role === 'user' && msg.type === 'text') {
      // Flush previous turn
      if (currentTurn) {
        turns.push(currentTurn)
      }
      currentTurn = {
        id: msg.id,
        userMessage: msg,
        thinkingMessages: [],
        resultMessage: undefined,
        isComplete: false
      }
      continue
    }

    // If no current turn, skip (shouldn't happen in normal flow)
    if (!currentTurn) {
      currentTurn = {
        id: `turn_${Date.now()}`,
        userMessage: undefined,
        thinkingMessages: [],
        resultMessage: undefined,
        isComplete: false
      }
    }

    // Categorize message
    if (msg.type === 'tool_use' || msg.type === 'tool_result') {
      currentTurn.thinkingMessages.push(msg)
    } else if (msg.type === 'result') {
      currentTurn.resultMessage = msg
      currentTurn.isComplete = true
    } else if (msg.type === 'done') {
      currentTurn.isComplete = true
    } else if (msg.type === 'text' && msg.role === 'assistant') {
      // 动态合并连续的 assistant text 消息
      // 如果已有 resultMessage 且也是 assistant text，则合并内容
      if (currentTurn.resultMessage &&
          currentTurn.resultMessage.type === 'text' &&
          currentTurn.resultMessage.role === 'assistant') {
        currentTurn.resultMessage = {
          ...currentTurn.resultMessage,
          content: currentTurn.resultMessage.content + (msg.content || ''),
        }
      } else if (currentTurn.thinkingMessages.length > 0) {
        // There are tool calls, so this text is part of thinking
        if (!currentTurn.resultMessage) {
          currentTurn.resultMessage = msg
        }
      } else {
        // No tool calls, this is a direct text response
        currentTurn.resultMessage = msg
      }
    } else if (msg.type === 'error') {
      currentTurn.thinkingMessages.push(msg)
    } else if (msg.type === 'turn_limit_warning') {
      currentTurn.thinkingMessages.push(msg)
    }
  }

  // Mark last turn as running if isRunning
  if (currentTurn) {
    if (isRunning) {
      currentTurn.isComplete = false
    } else if (currentTurn.thinkingMessages.length > 0 || currentTurn.resultMessage) {
      currentTurn.isComplete = true
    }
    turns.push(currentTurn)
  }

  return turns
}

export function MessageList({ messages, isRunning = false }: MessageListProps) {
  const turns = useMemo(() => groupIntoTurns(messages, isRunning), [messages, isRunning])

  if (turns.length === 0 && !isRunning) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
        <div className="size-16 rounded-full bg-primary/10 flex items-center justify-center mb-4">
          <Bot className="size-8 text-primary" />
        </div>
        <p className="text-lg font-medium text-foreground">开始对话</p>
        <p className="text-sm text-muted-foreground mt-1">
          问我任何问题，我可以帮助您完成各种任务
        </p>
      </div>
    )
  }

  return (
    <div className="p-4 space-y-6">
      {turns.map((turn, index) => (
        <ConversationTurnItem
          key={turn.id}
          turn={turn}
          isLastTurn={index === turns.length - 1}
          isRunning={isRunning && index === turns.length - 1}
        />
      ))}
    </div>
  )
}

/**
 * Render a single conversation turn
 */
function ConversationTurnItem({
  turn,
  isLastTurn,
  isRunning
}: {
  turn: ConversationTurn
  isLastTurn: boolean
  isRunning: boolean
}) {
  return (
    <div className="space-y-3">
      {/* User message */}
      {turn.userMessage && (
        <MessageItem message={turn.userMessage} />
      )}

      {/* Thinking process (collapsible) */}
      <ThinkingProcess
        messages={turn.thinkingMessages}
        isComplete={turn.isComplete && !isRunning}
      />

      {/* Final result */}
      {turn.resultMessage && (
        <div className="flex justify-start gap-2">
          <div className="flex-shrink-0 size-8 rounded-full bg-primary flex items-center justify-center">
            <Bot className="size-4 text-primary-foreground" />
          </div>
          <div className="max-w-[80%] flex flex-col items-start">
            <div className="bg-card border border-border/50 rounded-xl px-4 py-3 shadow-sm">
              <p className="whitespace-pre-wrap text-foreground">
                {turn.resultMessage.content}
              </p>
            </div>
            <span className="text-xs text-muted-foreground mt-1 ml-2">
              {formatTime(turn.resultMessage.timestamp)}
            </span>
          </div>
        </div>
      )}

      {/* Show loading indicator if running and no result yet */}
      {isLastTurn && isRunning && !turn.resultMessage && turn.thinkingMessages.length === 0 && (
        <div className="flex justify-start gap-2">
          <div className="flex-shrink-0 size-8 rounded-full bg-primary flex items-center justify-center">
            <Bot className="size-4 text-primary-foreground" />
          </div>
          <div className="bg-card border border-border/50 rounded-xl px-4 py-3 shadow-sm">
            <div className="flex items-center gap-2">
              <div className="animate-spin size-4 border-2 border-primary border-t-transparent rounded-full" />
              <span className="text-muted-foreground text-sm">思考中...</span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * Format timestamp to time string
 */
function formatTime(timestamp: number) {
  return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}
