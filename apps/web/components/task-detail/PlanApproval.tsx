/**
 * PlanApproval Component - easywork Style
 *
 * Displays the execution plan and allows user to approve or reject it.
 * Part of the easywork-style two-phase execution workflow.
 */

import { useState } from 'react'
import { cn } from '@/shared/lib/utils'
import { Check, X, ChevronDown, ChevronUp, ListTodo, Play, Ban, CheckCircle2 } from 'lucide-react'
import type { TaskPlan } from '@shared-types'

interface PlanApprovalProps {
  plan: TaskPlan
  isWaitingApproval: boolean
  onApprove: () => void
  onReject: () => void
}

export function PlanApproval({ plan, isWaitingApproval, onApprove, onReject }: PlanApprovalProps) {
  const [isExpanded, setIsExpanded] = useState(true)
  const [isProcessing, setIsProcessing] = useState(false)

  const handleApprove = async () => {
    setIsProcessing(true)
    try {
      await onApprove()
    } finally {
      setIsProcessing(false)
    }
  }

  const handleReject = () => {
    onReject()
  }

  // Determine status for styling
  const isCancelled = !isWaitingApproval && plan.steps.every(s => s.status === 'pending')
  const isAllCompleted = plan.steps.every(s => s.status === 'completed' || s.status === 'failed')

  return (
    <div className={cn(
      'my-4 space-y-4 rounded-xl border p-4',
      isCancelled
        ? 'border-muted-foreground/30 bg-muted/30'
        : isAllCompleted
          ? 'border-emerald-500/30 bg-emerald-50/30 dark:bg-emerald-950/20'
          : 'border-primary/30 bg-accent/30'
    )}>
      {/* Header */}
      <div className="flex items-start gap-3">
        <div className={cn(
          'flex size-10 shrink-0 items-center justify-center rounded-full',
          isAllCompleted
            ? 'bg-emerald-100 dark:bg-emerald-900/50'
            : isCancelled
              ? 'bg-muted'
              : 'bg-primary/10'
        )}>
          {isAllCompleted ? (
            <CheckCircle2 className="size-5 text-emerald-600 dark:text-emerald-400" />
          ) : isCancelled ? (
            <Ban className="size-5 text-muted-foreground" />
          ) : (
            <ListTodo className="size-5 text-primary" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="font-medium text-foreground">
              {isAllCompleted ? '执行计划已完成' : isCancelled ? '执行计划已取消' : '执行计划'}
            </h3>
            {isWaitingApproval && (
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-900/50 dark:text-amber-300">
                待审批
              </span>
            )}
            {isAllCompleted && (
              <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300">
                已完成
              </span>
            )}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {plan.goal || `共 ${plan.steps.length} 个步骤`}
          </p>
        </div>
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-sm text-muted-foreground hover:bg-muted"
        >
          {isExpanded ? (
            <>
              <ChevronUp className="size-4" />
              <span>收起</span>
            </>
          ) : (
            <>
              <ChevronDown className="size-4" />
              <span>展开</span>
            </>
          )}
        </button>
      </div>

      {/* Goal */}
      {isExpanded && plan.goal && (
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">目标</p>
          <p className="text-sm text-foreground">{plan.goal}</p>
        </div>
      )}

      {/* Steps */}
      {isExpanded && (
        <div className="space-y-2">
          {plan.steps.map((step, index) => (
            <div
              key={step.id}
              className="flex items-start gap-2.5"
            >
              {/* Step indicator */}
              <div
                className={cn(
                  'mt-0.5 flex size-5 shrink-0 items-center justify-center rounded border text-xs',
                  step.status === 'completed'
                    ? 'border-emerald-500 bg-emerald-500 text-white'
                    : step.status === 'in_progress'
                      ? 'border-primary bg-primary/10 text-primary'
                      : step.status === 'failed'
                        ? 'border-destructive bg-destructive text-destructive-foreground'
                        : 'border-muted-foreground/30 bg-background text-muted-foreground'
                )}
              >
                {step.status === 'completed' ? (
                  <Check className="size-3" />
                ) : step.status === 'in_progress' ? (
                  <div className="size-1.5 animate-pulse rounded-full bg-primary" />
                ) : step.status === 'failed' ? (
                  <X className="size-3" />
                ) : (
                  index + 1
                )}
              </div>
              {/* Step description */}
              <span
                className={cn(
                  'min-w-0 flex-1 text-sm leading-snug',
                  step.status === 'completed'
                    ? 'text-muted-foreground line-through'
                    : step.status === 'in_progress'
                      ? 'font-medium text-foreground'
                      : step.status === 'failed'
                        ? 'text-destructive'
                        : 'text-foreground'
                )}
              >
                {step.description}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Notes */}
      {isExpanded && plan.notes && (
        <div className="rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
          {plan.notes}
        </div>
      )}

      {/* Action Buttons */}
      {isWaitingApproval && (
        <div className="flex items-center justify-end gap-2 border-t border-border/50 pt-3">
          <button
            onClick={handleReject}
            disabled={isProcessing}
            className="flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-50"
          >
            <X className="size-4" />
            取消
          </button>
          <button
            onClick={handleApprove}
            disabled={isProcessing}
            className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
          >
            {isProcessing ? (
              <>
                <div className="size-4 animate-spin rounded-full border-2 border-primary-foreground border-t-transparent" />
                处理中...
              </>
            ) : (
              <>
                <Play className="size-4" />
                开始执行
              </>
            )}
          </button>
        </div>
      )}
    </div>
  )
}
