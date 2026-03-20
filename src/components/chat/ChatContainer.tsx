/**
 * Chat container component
 * Styled to match the project design system
 */

import { useAgent } from '@/shared/hooks/useAgent'
import { MessageList } from './MessageList'
import { ChatInput } from './ChatInput'
import { cn } from '@/shared/lib/utils'
import { Loader2, Trash2, ExternalLink } from 'lucide-react'

interface ChatContainerProps {
  onNewTask?: (prompt: string) => void
}

export function ChatContainer({ onNewTask }: ChatContainerProps) {
  const { messages, isRunning, error, run, abort, clear } = useAgent()

  const handleSubmit = (prompt: string) => {
    if (prompt.trim()) {
      // 如果提供了 onNewTask 回调，使用它（导航到 TaskDetail 页面）
      if (onNewTask) {
        onNewTask(prompt.trim())
      } else {
        // 否则在当前页面运行
        run(prompt.trim())
      }
    }
  }

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/50">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold text-foreground">Chat</h2>
          {isRunning && (
            <span className="flex items-center gap-1.5 text-sm text-primary">
              <Loader2 className="size-4 animate-spin" />
              Running...
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={clear}
            className={cn(
              'btn btn-ghost btn-sm text-muted-foreground',
              'hover:text-foreground'
            )}
          >
            <Trash2 className="size-4" />
            <span className="hidden sm:inline">Clear</span>
          </button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto">
        <MessageList messages={messages} />
      </div>

      {/* Error display */}
      {error && (
        <div className="mx-4 mb-2 px-4 py-3 bg-destructive/10 text-destructive rounded-lg border border-destructive/20">
          <p className="text-sm font-medium">Error</p>
          <p className="text-sm opacity-80">{error.message}</p>
        </div>
      )}

      {/* Input */}
      <div className="p-4">
        <ChatInput
          onSubmit={handleSubmit}
          onAbort={abort}
          disabled={false}
          isRunning={isRunning}
          submitLabel={onNewTask ? '开始任务' : undefined}
        />
      </div>
    </div>
  )
}
