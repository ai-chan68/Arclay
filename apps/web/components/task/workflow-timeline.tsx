/**
 * WorkflowTimeline - 工作流程时间线组件
 *
 * 展示多Agent协作的完整流程，包括任务分解、执行、结果汇总
 * 使用时间线的方式让用户看到整个过程
 */

import React, { useState } from 'react'
import type { SubTask, SubTaskResult, MultiAgentPhase } from '@shared-types'

export interface WorkflowTimelineProps {
  phase: MultiAgentPhase
  subtasks: SubTask[]
  results: Map<string, SubTaskResult>
  finalResult?: string
  className?: string
}

interface TimelineStep {
  id: string
  title: string
  description: string
  status: 'pending' | 'active' | 'completed'
  timestamp?: string
  details?: string
}

const PHASE_ICONS: Record<MultiAgentPhase, string> = {
  analyzing: '🔍',
  decomposing: '🧩',
  executing: '⚡',
  aggregating: '🤝',
  completed: '✨'
}

const PHASE_LABELS: Record<MultiAgentPhase, string> = {
  analyzing: 'Task Analysis',
  decomposing: 'Task Decomposition',
  executing: 'Parallel Execution',
  aggregating: 'Result Aggregation',
  completed: 'Task Completed'
}

const PHASE_DESCRIPTIONS: Record<MultiAgentPhase, string[]> = {
  analyzing: [
    'Scanning task requirements...',
    'Identifying complexity level...',
    'Determining execution strategy...'
  ],
  decomposing: [
    'Breaking down into subtasks...',
    'Assigning to available agents...',
    'Setting up execution plan...'
  ],
  executing: [
    'Agents working in parallel...',
    'Processing subtasks...',
    'Generating outputs...'
  ],
  aggregating: [
    'Collecting results from all agents...',
    'Merging outputs...',
    'Finalizing response...'
  ],
  completed: [
    'All tasks completed!',
    'Results ready for review',
    'Performance metrics calculated'
  ]
}

export function WorkflowTimeline({
  phase,
  subtasks,
  results,
  finalResult,
  className = ''
}: WorkflowTimelineProps) {
  const [expandedStep, setExpandedStep] = useState<string | null>(null)

  // 构建时间线步骤
  const timelineSteps: TimelineStep[] = [
    {
      id: 'analyzing',
      title: PHASE_LABELS.analyzing,
      description: PHASE_DESCRIPTIONS.analyzing.join('\n'),
      status: getStepStatus('analyzing', phase)
    },
    {
      id: 'decomposing',
      title: PHASE_LABELS.decomposing,
      description: `Created ${subtasks.length} subtasks`,
      status: getStepStatus('decomposing', phase),
      details: subtasks.length > 0 ? `Subtasks:\n${subtasks.map(s => `- ${s.description}`).join('\n')}` : undefined
    },
    {
      id: 'executing',
      title: PHASE_LABELS.executing,
      description: `${subtasks.filter(s => {
        const result = results.get(s.id)
        return result && result.status === 'success'
      }).length}/${subtasks.length} tasks completed`,
      status: getStepStatus('executing', phase),
      details: getExecutionDetails(subtasks, results)
    },
    {
      id: 'aggregating',
      title: PHASE_LABELS.aggregating,
      description: 'Combining agent outputs...',
      status: getStepStatus('aggregating', phase)
    },
    {
      id: 'completed',
      title: PHASE_LABELS.completed,
      description: finalResult ? 'Final result generated' : 'Waiting for completion...',
      status: getStepStatus('completed', phase),
      details: finalResult
    }
  ]

  const currentStepIndex = timelineSteps.findIndex(s => s.status === 'active')

  return (
    <div className={`workflow-timeline ${className}`}>
      {/* 顶部当前阶段显示 */}
      <div className="bg-gradient-to-r from-purple-500 to-pink-500 text-white rounded-lg p-4 mb-6">
        <div className="flex items-center gap-3">
          <span className="text-4xl">{PHASE_ICONS[phase]}</span>
          <div>
            <h3 className="text-xl font-bold">{PHASE_LABELS[phase]}</h3>
            <p className="text-sm opacity-90">
              {PHASE_DESCRIPTIONS[phase][Math.floor(Math.random() * PHASE_DESCRIPTIONS[phase].length)]}
            </p>
          </div>
        </div>
      </div>

      {/* 时间线 */}
      <div className="relative">
        {/* 连接线 */}
        <div className="absolute left-6 top-0 bottom-0 w-0.5 bg-gray-200 dark:bg-gray-700"></div>

        {/* 步骤列表 */}
        <div className="space-y-4">
          {timelineSteps.map((step, index) => (
            <div key={step.id} className="relative pl-14">
              {/* 步骤节点 */}
              <div
                className={`absolute left-0 w-12 h-12 rounded-full flex items-center justify-center text-xl ${
                  step.status === 'completed'
                    ? 'bg-green-500 text-white'
                    : step.status === 'active'
                    ? 'bg-blue-500 text-white animate-pulse'
                    : 'bg-gray-200 dark:bg-gray-700 text-gray-400'
                }`}
              >
                {step.status === 'completed' ? '✓' : index + 1}
              </div>

              {/* 步骤内容 */}
              <div
                className={`bg-white dark:bg-gray-800 rounded-lg p-4 border-2 cursor-pointer transition-all ${
                  step.status === 'active'
                    ? 'border-blue-500 shadow-lg'
                    : step.status === 'completed'
                    ? 'border-green-500'
                    : 'border-gray-200 dark:border-gray-700'
                }`}
                onClick={() => setExpandedStep(expandedStep === step.id ? null : step.id)}
              >
                <div className="flex items-center justify-between mb-2">
                  <h4 className="font-medium">{step.title}</h4>
                  {step.status === 'active' && (
                    <span className="text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded-full animate-pulse">
                      In Progress
                    </span>
                  )}
                  {step.status === 'completed' && (
                    <span className="text-xs bg-green-100 text-green-800 px-2 py-1 rounded-full">
                      Completed
                    </span>
                  )}
                </div>

                <p className="text-sm text-gray-600 dark:text-gray-400 whitespace-pre-line">
                  {step.description}
                </p>

                {/* 展开详情 */}
                {expandedStep === step.id && step.details && (
                  <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700">
                    <pre className="text-xs text-gray-700 dark:text-gray-300 whitespace-pre-wrap bg-gray-50 dark:bg-gray-900 rounded p-3 overflow-x-auto">
                      {step.details}
                    </pre>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// 获取步骤状态
function getStepStatus(stepPhase: MultiAgentPhase, currentPhase: MultiAgentPhase): 'pending' | 'active' | 'completed' {
  const phases: MultiAgentPhase[] = ['analyzing', 'decomposing', 'executing', 'aggregating', 'completed']
  const stepIndex = phases.indexOf(stepPhase)
  const currentIndex = phases.indexOf(currentPhase)

  if (stepIndex < currentIndex) return 'completed'
  if (stepIndex === currentIndex) return 'active'
  return 'pending'
}

// 获取执行详情
function getExecutionDetails(subtasks: SubTask[], results: Map<string, SubTaskResult>): string | undefined {
  if (subtasks.length === 0) return undefined

  const details = subtasks.map(subtask => {
    const result = results.get(subtask.id)
    const status = result?.status || 'pending'
    const emoji = status === 'success' ? '✅' : status === 'failed' ? '❌' : status === 'running' ? '▶️' : '⏸️'

    return `${emoji} ${subtask.description.slice(0, 50)}${subtask.description.length > 50 ? '...' : ''} [${status}]`
  })

  return `Execution Status:\n${details.join('\n')}`
}
