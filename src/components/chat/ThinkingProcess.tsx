/**
 * Thinking Process Component
 * DeepSeek-style collapsible thinking process display
 */

import { useState, useEffect, useRef } from 'react'
import type { AgentMessage } from '@shared-types'
import { cn } from '@/shared/lib/utils'
import { ChevronDown, ChevronRight, Loader2, CheckCircle, Brain, Wrench, AlertCircle } from 'lucide-react'
import { ToolCallDisplay } from './ToolCallDisplay'

interface ThinkingProcessProps {
  messages: AgentMessage[]
  isComplete: boolean
}

/**
 * Format timestamp to time string
 */
function formatTime(timestamp: number) {
  return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

/**
 * Thinking process component - shows tool calls and results
 * Can be collapsed when complete
 */
export function ThinkingProcess({ messages, isComplete }: ThinkingProcessProps) {
  const [isCollapsed, setIsCollapsed] = useState(false)
  const contentRef = useRef<HTMLDivElement>(null)

  // Auto-expand when new messages come in during streaming
  useEffect(() => {
    if (!isComplete) {
      setIsCollapsed(false)
    }
  }, [messages.length, isComplete])

  // Filter to only thinking-related messages (tool_use, tool_result)
  const thinkingMessages = messages.filter(
    msg => msg.type === 'tool_use' || msg.type === 'tool_result'
  )

  if (thinkingMessages.length === 0) {
    return null
  }

  // Count tool calls
  const toolCallCount = thinkingMessages.filter(m => m.type === 'tool_use').length
  const hasError = thinkingMessages.some(m => m.type === 'tool_result' && m.toolOutput?.includes('Error:'))

  return (
    <div className="my-3">
      {/* Header - clickable to expand/collapse */}
      <button
        onClick={() => setIsCollapsed(!isCollapsed)}
        className={cn(
          "w-full flex items-center gap-2 px-3 py-2 rounded-lg transition-colors",
          "bg-muted/50 hover:bg-muted/70 border border-border/30",
          isComplete && "cursor-pointer",
          !isComplete && "cursor-default"
        )}
        disabled={!isComplete}
      >
        {/* Collapse icon */}
        {isComplete && (
          isCollapsed ? (
            <ChevronRight className="size-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="size-4 text-muted-foreground" />
          )
        )}

        {/* Loading spinner or status icon */}
        {!isComplete ? (
          <Loader2 className="size-4 text-primary animate-spin" />
        ) : hasError ? (
          <AlertCircle className="size-4 text-amber-500" />
        ) : (
          <CheckCircle className="size-4 text-green-500" />
        )}

        {/* Icon */}
        <Brain className="size-4 text-muted-foreground" />

        {/* Title */}
        <span className="text-sm font-medium text-foreground">
          {!isComplete ? '思考中...' : '思考过程'}
        </span>

        {/* Tool count */}
        <span className="text-xs text-muted-foreground ml-auto">
          {toolCallCount} 次工具调用
        </span>
      </button>

      {/* Content - collapsible */}
      <div
        ref={contentRef}
        className={cn(
          "overflow-hidden transition-all duration-300",
          isCollapsed ? "max-h-0 opacity-0" : "max-h-[2000px] opacity-100"
        )}
      >
        <div className="mt-2 ml-4 pl-4 border-l-2 border-border/30 space-y-3">
          {thinkingMessages.map((msg) => (
            <ThinkingMessageItem key={msg.id} message={msg} />
          ))}
        </div>
      </div>
    </div>
  )
}

/**
 * Individual message item in the thinking process
 */
function ThinkingMessageItem({ message }: { message: AgentMessage }) {
  if (message.type === 'tool_use') {
    return (
      <div className="flex items-start gap-2">
        <div className="flex-shrink-0 size-5 rounded bg-secondary/20 flex items-center justify-center mt-0.5">
          <Wrench className="size-3 text-secondary" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="bg-muted/30 rounded-lg p-2 border border-border/20">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs font-medium text-foreground">
                {message.toolName}
              </span>
              <span className="text-xs text-muted-foreground">
                {formatTime(message.timestamp)}
              </span>
            </div>
            <ToolCallDisplay
              name={message.toolName || 'Unknown'}
              input={message.toolInput}
              id={message.toolUseId}
              compact
            />
          </div>
        </div>
      </div>
    )
  }

  if (message.type === 'tool_result') {
    const isError = message.toolOutput?.includes('Error:')
    return (
      <div className="flex items-start gap-2 ml-7">
        <div className="flex-shrink-0 size-4 rounded flex items-center justify-center mt-1">
          {isError ? (
            <AlertCircle className="size-3 text-destructive" />
          ) : (
            <CheckCircle className="size-3 text-green-500" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className={cn(
            "rounded-lg p-2 text-xs",
            isError ? "bg-destructive/5 text-destructive" : "bg-muted/20 text-muted-foreground"
          )}>
            <pre className="whitespace-pre-wrap overflow-x-auto max-h-32 overflow-y-auto font-mono">
              {message.toolOutput?.slice(0, 500)}
              {message.toolOutput && message.toolOutput.length > 500 && '...'}
            </pre>
          </div>
        </div>
      </div>
    )
  }

  return null
}
