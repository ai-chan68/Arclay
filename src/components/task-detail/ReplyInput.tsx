/**
 * ReplyInput - 回复输入组件
 */

import { useState, useRef, useEffect } from 'react'
import { cn } from '@/shared/lib/utils'
import { Send, Square, Loader2 } from 'lucide-react'

interface ReplyInputProps {
  placeholder?: string
  isRunning: boolean
  onSubmit: (text: string) => void
  onStop?: () => void
  disabled?: boolean
}

export function ReplyInput({
  placeholder = '输入回复...',
  isRunning,
  onSubmit,
  onStop,
  disabled = false,
}: ReplyInputProps) {
  const [text, setText] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // 自动调整高度
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`
    }
  }, [text])

  const handleSubmit = () => {
    console.log('[ReplyInput] handleSubmit called:', { text: text.trim(), isRunning, disabled })
    if (text.trim() && !isRunning && !disabled) {
      console.log('[ReplyInput] Calling onSubmit with text:', text.trim())
      onSubmit(text.trim())
      setText('')
    } else {
      console.log('[ReplyInput] Submit blocked:', { 
        hasText: !!text.trim(), 
        isRunning, 
        disabled 
      })
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  return (
    <div className="flex items-end gap-2 rounded-xl border border-gray-200 bg-white p-2 dark:border-gray-700 dark:bg-gray-800">
      <textarea
        ref={textareaRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={disabled || isRunning}
        className={cn(
          'max-h-[200px] min-h-[40px] flex-1 resize-none bg-transparent px-2 py-2 text-sm text-gray-700 outline-none placeholder:text-gray-400 dark:text-gray-300',
          (disabled || isRunning) && 'cursor-not-allowed opacity-50'
        )}
        rows={1}
      />

      {isRunning ? (
        <button
          onClick={onStop}
          className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-red-500 text-white transition-colors hover:bg-red-600"
          title="停止"
        >
          <Square className="size-4" />
        </button>
      ) : (
        <button
          onClick={handleSubmit}
          disabled={!text.trim() || disabled}
          className={cn(
            'flex size-9 shrink-0 items-center justify-center rounded-lg transition-colors',
            text.trim() && !disabled
              ? 'bg-orange-500 text-white hover:bg-orange-600'
              : 'bg-gray-100 text-gray-400 dark:bg-gray-700 dark:text-gray-500'
          )}
          title="发送"
        >
          <Send className="size-4" />
        </button>
      )}
    </div>
  )
}
