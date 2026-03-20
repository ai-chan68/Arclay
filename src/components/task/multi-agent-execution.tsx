/**
 * MultiAgentExecution - Full multi-agent execution visualization
 *
 * Combines TaskProgress, SubAgentStatus, and execution controls
 */

import React from 'react'
import { TaskProgress } from './task-progress'
import { SubAgentStatus } from './sub-agent-status'
import type { MultiAgentStatus, SubTaskResult } from '@shared-types'

export interface MultiAgentExecutionProps {
  status: MultiAgentStatus | null
  subtasks: Array<any> // SubTask type
  results: Map<string, SubTaskResult>
  cost?: { estimated: number; actual: number } | null
  onAbort?: () => void
  onRetrySubtask?: (subtaskId: string) => void
  onSkipSubtask?: (subtaskId: string) => void
  className?: string
}

export function MultiAgentExecution({
  status,
  subtasks,
  results,
  cost,
  onAbort,
  onRetrySubtask,
  onSkipSubtask,
  className = ''
}: MultiAgentExecutionProps) {
  if (!status) {
    return (
      <div className={`multi-agent-execution ${className}`}>
        <p className="text-gray-500 text-sm">No active execution</p>
      </div>
    )
  }

  const isExecuting = status.phase === 'executing'

  return (
    <div className={`multi-agent-execution space-y-4 ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between border-b pb-2">
        <div>
          <h3 className="font-semibold">Multi-Agent Execution</h3>
          <p className="text-xs text-gray-500">
            Orchestrator: {status.orchestrator.model}
          </p>
        </div>

        {/* Abort button */}
        {isExecuting && onAbort && (
          <button
            className="px-3 py-1 bg-red-500 text-white text-sm rounded hover:bg-red-600"
            onClick={onAbort}
          >
            Abort
          </button>
        )}
      </div>

      {/* Progress */}
      <TaskProgress
        phase={status.phase}
        progress={status.progress}
      />

      {/* Cost information */}
      {cost && (
        <div className="bg-gray-50 rounded p-3 text-sm">
          <div className="flex justify-between items-center">
            <span className="text-gray-600">Estimated Cost:</span>
            <span className="font-medium">${cost.estimated.toFixed(4)}</span>
          </div>
          {cost.actual > 0 && (
            <div className="flex justify-between items-center mt-1">
              <span className="text-gray-600">Actual Cost:</span>
              <span className="font-medium">${cost.actual.toFixed(4)}</span>
            </div>
          )}
        </div>
      )}

      {/* Subtasks */}
      {subtasks.length > 0 && (
        <div>
          <h4 className="font-medium text-sm mb-2">Subtasks</h4>
          <SubAgentStatus
            subtasks={subtasks}
            results={results}
            onRetry={onRetrySubtask}
            onSkip={onSkipSubtask}
          />
        </div>
      )}

      {/* Analysis info */}
      {status.analysis && (
        <div className="bg-blue-50 rounded p-3 text-sm">
          <div className="font-medium text-blue-800 mb-1">Task Analysis</div>
          <div className="text-blue-700 space-y-1">
            <div>Complexity: {status.analysis.complexity}</div>
            <div>Strategy: {status.analysis.decompositionStrategy}</div>
            <div>Recommended Parallelism: {status.analysis.recommendedParallelism}</div>
          </div>
        </div>
      )}
    </div>
  )
}
