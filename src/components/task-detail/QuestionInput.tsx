/**
 * QuestionInput Component
 *
 * Displays a pending question to the user and collects their response.
 * Part of the easywork-style interactive execution workflow.
 */

import { useState } from 'react'
import { cn } from '@/shared/lib/utils'
import { HelpCircle, Send } from 'lucide-react'
import { MarkdownRenderer } from '@/components/common/MarkdownRenderer'
import type { PendingQuestion } from '@shared-types'

interface QuestionInputProps {
  pendingQuestion: PendingQuestion
  fileBaseDir?: string
  onSubmit: (answers: Record<string, string>) => void
}

export function QuestionInput({ pendingQuestion, fileBaseDir, onSubmit }: QuestionInputProps) {
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleSubmit = async () => {
    setIsSubmitting(true)
    try {
      await onSubmit(answers)
    } finally {
      setIsSubmitting(false)
    }
  }

  const canSubmit = pendingQuestion.options
    ? Object.keys(answers).length > 0
    : answers['freeText']?.trim().length > 0

  return (
    <div className="my-4 rounded-xl border border-amber-200 bg-gradient-to-br from-amber-50 to-orange-50 p-4 dark:border-amber-800 dark:from-amber-950/30 dark:to-orange-950/30">
      {/* Header */}
      <div className="flex items-start gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900/50">
          <HelpCircle className="size-5 text-amber-600 dark:text-amber-400" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="font-medium text-gray-900 dark:text-gray-100">
            需要您的输入
          </h3>
          <div className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            <MarkdownRenderer content={pendingQuestion.question} fileBaseDir={fileBaseDir} />
          </div>
        </div>
      </div>

      {/* Options */}
      {pendingQuestion.options && pendingQuestion.options.length > 0 && (
        <div className="mt-4 space-y-2">
          {pendingQuestion.options.map((option, index) => (
            <button
              key={index}
              onClick={() => setAnswers({ selected: option })}
              className={cn(
                'w-full rounded-lg border p-3 text-left text-sm transition-colors',
                answers['selected'] === option
                  ? 'border-amber-500 bg-amber-100 dark:border-amber-400 dark:bg-amber-900/30'
                  : 'border-gray-200 bg-white hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800/50 dark:hover:bg-gray-800'
              )}
            >
              {option}
            </button>
          ))}
        </div>
      )}

      {/* Free text input */}
      {(pendingQuestion.allowFreeText || !pendingQuestion.options?.length) && (
        <div className="mt-4">
          <textarea
            value={answers['freeText'] || ''}
            onChange={(e) => setAnswers({ freeText: e.target.value })}
            placeholder="请输入您的回答..."
            className="w-full resize-none rounded-lg border border-gray-300 bg-white p-3 text-sm text-gray-900 placeholder:text-gray-400 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
            rows={3}
          />
        </div>
      )}

      {/* Submit button */}
      <div className="mt-4 flex justify-end">
        <button
          onClick={handleSubmit}
          disabled={!canSubmit || isSubmitting}
          className="flex items-center gap-2 rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-amber-700 disabled:opacity-50 dark:bg-amber-600 dark:hover:bg-amber-700"
        >
          {isSubmitting ? (
            <>
              <div className="size-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
              提交中...
            </>
          ) : (
            <>
              <Send className="size-4" />
              提交回答
            </>
          )}
        </button>
      </div>
    </div>
  )
}
