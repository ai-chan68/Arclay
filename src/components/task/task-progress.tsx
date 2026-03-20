/**
 * TaskProgress - Displays multi-agent execution progress
 *
 * Shows current phase, progress counts, and visual progress bar
 */

import React from 'react'
import type { MultiAgentPhase, MultiAgentProgress } from '@shared-types'

export interface TaskProgressProps {
  phase: MultiAgentPhase
  progress: MultiAgentProgress
  className?: string
}

const PHASE_LABELS: Record<MultiAgentPhase, string> = {
  analyzing: 'Analyzing Task',
  decomposing: 'Decomposing',
  executing: 'Executing',
  aggregating: 'Aggregating Results',
  completed: 'Completed'
}

const PHASE_COLORS: Record<MultiAgentPhase, string> = {
  analyzing: 'bg-blue-500',
  decomposing: 'bg-purple-500',
  executing: 'bg-green-500',
  aggregating: 'bg-yellow-500',
  completed: 'bg-green-600'
}

export function TaskProgress({ phase, progress, className = '' }: TaskProgressProps) {
  const percentage = progress.total > 0
    ? Math.round((progress.completed / progress.total) * 100)
    : 0

  return (
    <div className={`task-progress ${className}`}>
      {/* Phase indicator */}
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium text-gray-700">
          {PHASE_LABELS[phase]}
        </span>
        <span className="text-xs text-gray-500">
          {progress.completed}/{progress.total} tasks
        </span>
      </div>

      {/* Progress bar */}
      <div className="w-full bg-gray-200 rounded-full h-2 mb-2">
        <div
          className={`h-2 rounded-full transition-all duration-300 ${PHASE_COLORS[phase]}`}
          style={{ width: `${percentage}%` }}
        />
      </div>

      {/* Stats row */}
      <div className="flex items-center justify-between text-xs text-gray-600">
        <span>Running: {progress.running}</span>
        <span>Failed: {progress.failed}</span>
        <span>{percentage}% complete</span>
      </div>
    </div>
  )
}
