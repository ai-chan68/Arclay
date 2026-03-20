/**
 * Message item component
 * Styled to match the project design system
 */

import type { AgentMessage } from '@shared-types'
import { ToolCallDisplay } from './ToolCallDisplay'
import { cn } from '@/shared/lib/utils'
import { User, Bot, Wrench, CheckCircle, AlertCircle } from 'lucide-react'

interface MessageItemProps {
  message: AgentMessage
}

export function MessageItem({ message }: MessageItemProps) {
  const isUser = message.role === 'user'

  // Don't render session or done messages
  if (message.type === 'session' || message.type === 'done') {
    return null
  }

  const formatTime = (timestamp: number) => {
    return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }

  // User message - right aligned, accent background
  if (isUser && message.type === 'text') {
    return (
      <div className="flex justify-end gap-2">
        <div className="max-w-[80%] flex flex-col items-end">
          <div className="bg-accent/50 rounded-xl px-4 py-3">
            <p className="whitespace-pre-wrap text-foreground">{message.content}</p>
          </div>
          <span className="text-xs text-muted-foreground mt-1 mr-2">
            {formatTime(message.timestamp)}
          </span>
        </div>
        <div className="flex-shrink-0 size-8 rounded-full bg-primary/10 flex items-center justify-center">
          <User className="size-4 text-primary" />
        </div>
      </div>
    )
  }

  // Assistant text message - left aligned
  if (message.type === 'text' && message.content) {
    return (
      <div className="flex justify-start gap-2">
        <div className="flex-shrink-0 size-8 rounded-full bg-primary flex items-center justify-center">
          <Bot className="size-4 text-primary-foreground" />
        </div>
        <div className="max-w-[80%] flex flex-col items-start">
          <div className="bg-card border border-border/50 rounded-xl px-4 py-3 shadow-sm">
            <p className="whitespace-pre-wrap text-foreground">
              {message.content}
            </p>
          </div>
          <span className="text-xs text-muted-foreground mt-1 ml-2">
            {formatTime(message.timestamp)}
          </span>
        </div>
      </div>
    )
  }

  // Tool use - styled differently
  if (message.type === 'tool_use') {
    return (
      <div className="flex justify-start gap-2">
        <div className="flex-shrink-0 size-8 rounded-full bg-secondary/10 flex items-center justify-center">
          <Wrench className="size-4 text-secondary" />
        </div>
        <div className="max-w-[85%]">
          <div className="border-border/50 bg-muted/50 rounded-lg border p-3">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xs font-medium text-secondary uppercase">
                Tool Call
              </span>
              <span className="text-xs text-muted-foreground">
                {formatTime(message.timestamp)}
              </span>
            </div>
            <ToolCallDisplay
              name={message.toolName || 'Unknown'}
              input={message.toolInput}
              id={message.toolUseId}
            />
          </div>
        </div>
      </div>
    )
  }

  // Tool result
  if (message.type === 'tool_result') {
    const isError = message.toolOutput?.includes('Error:')
    return (
      <div className="flex justify-start gap-2 ml-10">
        <div className="flex-shrink-0 size-6 rounded-full bg-muted flex items-center justify-center">
          {isError ? (
            <AlertCircle className="size-3 text-destructive" />
          ) : (
            <CheckCircle className="size-3 text-green-500" />
          )}
        </div>
        <div className="max-w-[85%] flex-1">
          <div className={cn(
            'border-border/50 rounded-lg border p-3',
            isError ? 'bg-destructive/5' : 'bg-muted/30'
          )}>
            <div className="flex items-center gap-2 mb-2">
              <span className={cn(
                'text-xs font-medium uppercase',
                isError ? 'text-destructive' : 'text-green-600'
              )}>
                Tool Result
              </span>
              <span className="text-xs text-muted-foreground">
                {formatTime(message.timestamp)}
              </span>
            </div>
            <div className="text-xs text-muted-foreground mb-1">
              For: {message.toolUseId?.slice(0, 8)}...
            </div>
            <pre className="text-sm whitespace-pre-wrap overflow-x-auto max-h-48 overflow-y-auto bg-black/5 dark:bg-white/5 p-2 rounded font-mono">
              {message.toolOutput}
            </pre>
          </div>
        </div>
      </div>
    )
  }

  // Error
  if (message.type === 'error') {
    return (
      <div className="flex justify-center">
        <div className="max-w-[90%] bg-destructive/10 border border-destructive/20 rounded-lg p-3">
          <div className="flex items-center gap-2 mb-1">
            <AlertCircle className="size-4 text-destructive" />
            <span className="text-xs font-medium text-destructive uppercase">
              Error
            </span>
            <span className="text-xs text-muted-foreground">
              {formatTime(message.timestamp)}
            </span>
          </div>
          <p className="text-destructive text-sm">
            {message.errorMessage}
          </p>
        </div>
      </div>
    )
  }

  return null
}
