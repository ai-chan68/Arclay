/**
 * ChatInput Component
 *
 * Enhanced chat input with attachment support.
 * Replaces the simpler ReplyInput component.
 */

import { useState, useRef, useCallback } from 'react'
import { cn } from '@/shared/lib/utils'
import { Send, Square, Paperclip, X, Image, FileText, FileSpreadsheet, Presentation, FileCode } from 'lucide-react'
import type { MessageAttachment } from '@shared-types'

/**
 * 根据文件类型返回对应的图标组件
 */
function getFileIcon(type: string) {
  if (type.startsWith('image/')) {
    return <Image className="size-3.5 text-purple-500" />
  }
  // Spreadsheet
  if (
    type.includes('excel') ||
    type.includes('spreadsheet') ||
    type === 'text/csv'
  ) {
    return <FileSpreadsheet className="size-3.5 text-green-500" />
  }
  // Presentation
  if (type.includes('presentation') || type.includes('powerpoint')) {
    return <Presentation className="size-3.5 text-orange-500" />
  }
  // Code/Data files
  if (
    type === 'application/json' ||
    type === 'text/plain' ||
    type === 'text/markdown' ||
    type.includes('javascript') ||
    type.includes('typescript') ||
    type.includes('python') ||
    type.includes('html') ||
    type.includes('css')
  ) {
    return <FileCode className="size-3.5 text-blue-500" />
  }
  // Default document
  return <FileText className="size-3.5 text-gray-500" />
}

interface ChatInputProps {
  placeholder?: string
  isRunning: boolean
  disabled?: boolean
  disabledReason?: string
  onSubmit: (text: string, attachments?: MessageAttachment[]) => void
  onStop: () => void
}

export function ChatInput({
  placeholder = '输入消息...',
  isRunning,
  disabled = false,
  disabledReason,
  onSubmit,
  onStop,
}: ChatInputProps) {
  const [text, setText] = useState('')
  const [attachments, setAttachments] = useState<MessageAttachment[]>([])
  const [isDragging, setIsDragging] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const isInputDisabled = isRunning || disabled

  const handleSubmit = useCallback(() => {
    if (isInputDisabled) return
    if (!text.trim() && attachments.length === 0) return
    onSubmit(text.trim(), attachments.length > 0 ? attachments : undefined)
    setText('')
    setAttachments([])
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }
  }, [isInputDisabled, text, attachments, onSubmit])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (isInputDisabled) return
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }, [handleSubmit, isInputDisabled])

  const handleTextChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setText(e.target.value)
    // Auto-resize
    const textarea = e.target
    textarea.style.height = 'auto'
    textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`
  }, [])

  const handleFileSelect = useCallback(async (files: FileList | null) => {
    if (!files) return

    const newAttachments: MessageAttachment[] = []

    for (const file of Array.from(files)) {
      // Check file size (max 10MB)
      if (file.size > 10 * 1024 * 1024) {
        console.warn(`File ${file.name} is too large (max 10MB)`)
        continue
      }

      const reader = new FileReader()
      const data = await new Promise<string>((resolve) => {
        reader.onload = () => resolve(reader.result as string)
        reader.readAsDataURL(file)
      })

      newAttachments.push({
        id: `att_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
        name: file.name,
        type: file.type,
        data,
        size: file.size,
      })
    }

    setAttachments(prev => [...prev, ...newAttachments])
  }, [])

  const removeAttachment = useCallback((id: string) => {
    setAttachments(prev => prev.filter(att => att.id !== id))
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    handleFileSelect(e.dataTransfer.files)
  }, [handleFileSelect])

  return (
    <div
      className={cn(
        'ew-card relative rounded-2xl transition-colors',
        isInputDisabled && 'opacity-80',
        isDragging
          ? 'ew-highlight'
          : ''
      )}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Attachments preview */}
      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-2 border-b border-border p-3">
          {attachments.map(att => (
            <div
              key={att.id}
              className="ew-control flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs"
            >
              {getFileIcon(att.type)}
              <span className="max-w-[120px] truncate ew-text">
                {att.name}
              </span>
              <button
                onClick={() => removeAttachment(att.id)}
                className="ew-icon-btn ml-1 rounded p-0.5"
              >
                <X className="size-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Text input */}
      <div className="flex items-end gap-2 p-3">
        <textarea
          ref={textareaRef}
          value={text}
          onChange={handleTextChange}
          onKeyDown={handleKeyDown}
          placeholder={isDragging ? '释放以上传文件' : placeholder}
          disabled={isInputDisabled}
          rows={1}
          className="max-h-[200px] min-h-[44px] flex-1 resize-none bg-transparent px-2 py-2.5 text-sm ew-text placeholder:text-[color:var(--ui-subtext)] focus:outline-none disabled:opacity-50"
        />

        {/* Attachment button */}
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={isInputDisabled}
          className="ew-icon-btn flex size-9 shrink-0 items-center justify-center rounded-lg transition-colors disabled:opacity-50"
          title="添加附件"
        >
          <Paperclip className="size-5" />
        </button>

        {/* Send/Stop button */}
        {isRunning ? (
          <button
            onClick={onStop}
            className="ew-danger-soft flex size-9 shrink-0 items-center justify-center rounded-lg text-red-600 transition-colors hover:brightness-105"
            title="停止"
          >
            <Square className="size-4 fill-current" />
          </button>
        ) : (
          <button
            onClick={handleSubmit}
            disabled={isInputDisabled || (!text.trim() && attachments.length === 0)}
            className="ew-button-primary flex size-9 shrink-0 items-center justify-center rounded-lg transition-colors disabled:opacity-50"
            title="发送"
          >
            <Send className="size-4" />
          </button>
        )}
      </div>

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="image/*,.txt,.md,.json,.js,.ts,.jsx,.tsx,.py,.html,.css,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.pdf,.csv"
        onChange={e => handleFileSelect(e.target.files)}
        className="hidden"
      />

      {disabledReason && (
        <div className="border-t border-border px-3 py-2 text-xs text-amber-600">
          {disabledReason}
        </div>
      )}
    </div>
  )
}
