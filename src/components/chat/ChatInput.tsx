/**
 * Chat input component
 * Styled to match the project design system
 */

import { useState, useCallback } from 'react'
import { cn } from '../../shared/lib/utils'
import { Send, Square } from 'lucide-react'

interface ChatInputProps {
  onSubmit: (prompt: string) => void
  onAbort?: () => void
  disabled?: boolean
  isRunning?: boolean
  variant?: 'default' | 'compact'
  submitLabel?: string
}

export function ChatInput({
  onSubmit,
  onAbort,
  disabled,
  isRunning = false,
  variant = 'default',
  submitLabel
}: ChatInputProps) {
  const [input, setInput] = useState('')

  const handleSubmit = useCallback(() => {
    if (input.trim() && !disabled && !isRunning) {
      onSubmit(input)
      setInput('')
    }
  }, [input, disabled, isRunning, onSubmit])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  const isCompact = variant === 'compact'

  return (
    <div
      className={cn(
        'border-border/50 bg-background shadow-lg',
        isCompact
          ? 'rounded-xl border p-3'
          : 'rounded-2xl border p-4'
      )}
    >
      <div className="flex items-end gap-3">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={isRunning ? 'Agent is working...' : 'Ask me anything...'}
          disabled={disabled || isRunning}
          rows={isCompact ? 1 : 3}
          className={cn(
            'text-foreground placeholder:text-muted-foreground w-full resize-none border-0 bg-transparent',
            'focus:outline-none disabled:cursor-not-allowed disabled:opacity-50',
            isCompact ? 'min-h-[24px]' : 'min-h-[72px]'
          )}
        />

        {/* Action button */}
        {isRunning ? (
          <button
            onClick={onAbort}
            className={cn(
              'flex items-center justify-center rounded-full transition-all',
              'bg-red-500 text-white hover:bg-red-600',
              isCompact ? 'size-8' : 'size-9'
            )}
            title="Stop"
          >
            <Square className={isCompact ? 'size-3' : 'size-4'} fill="currentColor" />
          </button>
        ) : (
          <button
            onClick={handleSubmit}
            disabled={disabled || !input.trim()}
            className={cn(
              'flex items-center justify-center rounded-full transition-all',
              'bg-foreground text-background',
              'disabled:bg-muted disabled:text-muted-foreground disabled:cursor-not-allowed',
              isCompact ? 'size-8 px-3' : 'size-9 px-4',
              submitLabel && 'rounded-xl gap-1.5'
            )}
            title={submitLabel || 'Send'}
          >
            {submitLabel ? (
              <>
                <span className="text-xs font-medium">{submitLabel}</span>
                <Send className="size-3.5" />
              </>
            ) : (
              <Send className="size-4" />
            )}
          </button>
        )}
      </div>

      {/* Hint text */}
      {!isCompact && (
        <p className="mt-2 text-xs text-muted-foreground">
          Press <kbd className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px]">Enter</kbd> to send,{' '}
          <kbd className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px]">Shift+Enter</kbd> for new line
        </p>
      )}
    </div>
  )
}
