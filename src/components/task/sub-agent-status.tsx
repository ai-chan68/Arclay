/**
 * SubAgentStatus - Displays status of individual sub-agents
 *
 * Shows list of subtasks with their status, allows expansion for details
 */

import React, { useState } from 'react'
import type { SubTask, SubTaskResult, SubTaskStatus } from '@shared-types'

export interface SubAgentStatusProps {
  subtasks: SubTask[]
  results: Map<string, SubTaskResult>
  onRetry?: (subtaskId: string) => void
  onSkip?: (subtaskId: string) => void
  className?: string
}

const STATUS_ICONS: Record<SubTaskStatus, string> = {
  pending: '⏸️',
  running: '▶️',
  success: '✅',
  failed: '❌',
  timeout: '⏱️',
  skipped: '⏭️'
}

const STATUS_COLORS: Record<SubTaskStatus, string> = {
  pending: 'text-gray-500',
  running: 'text-blue-600',
  success: 'text-green-600',
  failed: 'text-red-600',
  timeout: 'text-orange-600',
  skipped: 'text-gray-400'
}

const PRIORITY_BADGES: Record<string, string> = {
  high: 'bg-red-100 text-red-800',
  medium: 'bg-yellow-100 text-yellow-800',
  low: 'bg-gray-100 text-gray-800'
}

export function SubAgentStatus({
  subtasks,
  results,
  onRetry,
  onSkip,
  className = ''
}: SubAgentStatusProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const toggleExpand = (id: string) => {
    setExpandedId(expandedId === id ? null : id)
  }

  return (
    <div className={`sub-agent-status ${className}`}>
      <div className="space-y-2">
        {subtasks.map(subtask => {
          const result = results.get(subtask.id)
          const status = result?.status || 'pending'
          const isExpanded = expandedId === subtask.id

          return (
            <div
              key={subtask.id}
              className="border rounded-lg p-3 hover:bg-gray-50 cursor-pointer"
              onClick={() => toggleExpand(subtask.id)}
            >
              {/* Header row */}
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <span>{STATUS_ICONS[status]}</span>
                  <span className="font-medium text-sm">{subtask.description}</span>
                </div>
                <div className="flex items-center space-x-2">
                  <span className={`text-xs px-2 py-1 rounded ${PRIORITY_BADGES[subtask.priority]}`}>
                    {subtask.priority}
                  </span>
                  <span className={`text-xs ${STATUS_COLORS[status]}`}>
                    {status}
                  </span>
                </div>
              </div>

              {/* Expanded details */}
              {isExpanded && (
                <div className="mt-3 pt-3 border-t text-sm">
                  {/* Scope */}
                  {subtask.scope.files && subtask.scope.files.length > 0 && (
                    <div className="mb-2">
                      <span className="text-gray-500">Files:</span>
                      <span className="ml-2">{subtask.scope.files.join(', ')}</span>
                    </div>
                  )}

                  {subtask.scope.range && (
                    <div className="mb-2">
                      <span className="text-gray-500">Lines:</span>
                      <span className="ml-2">
                        {subtask.scope.range[0]} - {subtask.scope.range[1]}
                      </span>
                    </div>
                  )}

                  {subtask.scope.type && (
                    <div className="mb-2">
                      <span className="text-gray-500">Type:</span>
                      <span className="ml-2">{subtask.scope.type}</span>
                    </div>
                  )}

                  {/* Result output */}
                  {result?.output && (
                    <div className="mb-2">
                      <span className="text-gray-500">Output:</span>
                      <pre className="mt-1 p-2 bg-gray-100 rounded text-xs overflow-x-auto">
                        {result.output}
                      </pre>
                    </div>
                  )}

                  {/* Error message */}
                  {result?.error && (
                    <div className="mb-2">
                      <span className="text-red-500">Error:</span>
                      <pre className="mt-1 p-2 bg-red-50 rounded text-xs overflow-x-auto">
                        {result.error}
                      </pre>
                    </div>
                  )}

                  {/* Duration */}
                  {result?.duration && (
                    <div className="text-xs text-gray-400">
                      Duration: {(result.duration / 1000).toFixed(2)}s
                    </div>
                  )}

                  {/* Actions */}
                  {(status === 'failed' || status === 'timeout') && (
                    <div className="mt-2 flex space-x-2">
                      {onRetry && (
                        <button
                          className="text-xs px-3 py-1 bg-blue-100 text-blue-700 rounded hover:bg-blue-200"
                          onClick={(e) => {
                            e.stopPropagation()
                            onRetry(subtask.id)
                          }}
                        >
                          Retry
                        </button>
                      )}
                      {onSkip && (
                        <button
                          className="text-xs px-3 py-1 bg-gray-100 text-gray-700 rounded hover:bg-gray-200"
                          onClick={(e) => {
                            e.stopPropagation()
                            onSkip(subtask.id)
                          }}
                        >
                          Skip
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
