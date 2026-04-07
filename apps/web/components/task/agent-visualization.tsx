/**
 * AgentVisualization - 多Agent可视化组件
 *
 * 展示Agent的思考过程、状态变化和协作关系
 * 让用户直观感受到多个Agent在并行工作
 */

import React, { useEffect, useState } from 'react'
import type { SubTask, SubTaskResult, SubTaskStatus } from '@shared-types'

export interface AgentVisualizationProps {
  subtasks: SubTask[]
  results: Map<string, SubTaskResult>
  currentPhase: string
  className?: string
}

interface AgentNode {
  id: string
  name: string
  status: SubTaskStatus
  thinking: string[]
  isThinking: boolean
}

const AGENT_AVATARS = ['🤖', '🦾', '🧠', '⚡', '🔬', '🚀']
const AGENT_NAMES = ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Zeta']

const STATUS_STYLES: Record<SubTaskStatus, {
  bg: string
  border: string
  pulse: boolean
  glow: boolean
}> = {
  pending: {
    bg: 'bg-gray-100 dark:bg-gray-800',
    border: 'border-gray-300 dark:border-gray-600',
    pulse: false,
    glow: false
  },
  running: {
    bg: 'bg-blue-50 dark:bg-blue-900/20',
    border: 'border-blue-400 dark:border-blue-500',
    pulse: true,
    glow: true
  },
  success: {
    bg: 'bg-green-50 dark:bg-green-900/20',
    border: 'border-green-400 dark:border-green-500',
    pulse: false,
    glow: false
  },
  failed: {
    bg: 'bg-red-50 dark:bg-red-900/20',
    border: 'border-red-400 dark:border-red-500',
    pulse: false,
    glow: false
  },
  timeout: {
    bg: 'bg-orange-50 dark:bg-orange-900/20',
    border: 'border-orange-400 dark:border-orange-500',
    pulse: false,
    glow: false
  },
  skipped: {
    bg: 'bg-gray-50 dark:bg-gray-800/50',
    border: 'border-gray-300 dark:border-gray-600',
    pulse: false,
    glow: false
  }
}

export function AgentVisualization({
  subtasks,
  results,
  currentPhase,
  className = ''
}: AgentVisualizationProps) {
  const [thinkingDots, setThinkingDots] = useState('')

  // 动态显示思考中的点点点
  useEffect(() => {
    const interval = setInterval(() => {
      setThinkingDots(prev => prev.length >= 3 ? '' : prev + '.')
    }, 500)
    return () => clearInterval(interval)
  }, [])

  // 转换为Agent节点数据
  const agentNodes: AgentNode[] = subtasks.map((subtask, index) => {
    const result = results.get(subtask.id)
    const status = result?.status || 'pending'

    return {
      id: subtask.id,
      name: AGENT_NAMES[index % AGENT_NAMES.length],
      status,
      thinking: getThinkingMessages(status, subtask.description),
      isThinking: status === 'running'
    }
  })

  // 统计信息
  const runningAgents = agentNodes.filter(a => a.status === 'running').length
  const completedAgents = agentNodes.filter(a => a.status === 'success').length
  const totalAgents = agentNodes.length

  return (
    <div className={`agent-visualization ${className}`}>
      {/* 顶部状态栏 */}
      <div className="bg-gradient-to-r from-blue-500 to-purple-500 text-white rounded-lg p-4 mb-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-bold flex items-center gap-2">
              <span className="animate-pulse">⚡</span>
              Multi-Agent Collaboration
            </h3>
            <p className="text-sm opacity-90">
              {runningAgents > 0
                ? `${runningAgents} agents working in parallel${thinkingDots}`
                : currentPhase === 'completed'
                  ? 'All agents completed successfully ✓'
                  : 'Preparing agent deployment...'}
            </p>
          </div>
          <div className="text-right">
            <div className="text-3xl font-bold">{completedAgents}/{totalAgents}</div>
            <div className="text-xs opacity-75">tasks completed</div>
          </div>
        </div>
      </div>

      {/* Agent网格 */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-4">
        {agentNodes.map((agent, index) => (
          <AgentCard
            key={agent.id}
            agent={agent}
            avatar={AGENT_AVATARS[index % AGENT_AVATARS.length]}
            thinkingDots={thinkingDots}
          />
        ))}
      </div>

      {/* 协作网络可视化 */}
      <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-4">
        <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
          🔄 Collaboration Network
        </h4>
        <div className="h-32 flex items-center justify-center relative">
          {/* 中心节点 - Orchestrator */}
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
            <div className="w-16 h-16 rounded-full bg-gradient-to-br from-blue-500 to-purple-500 flex items-center justify-center text-white text-2xl shadow-lg">
              🎯
            </div>
            <div className="text-xs text-center mt-1 font-medium">Orchestrator</div>
          </div>

          {/* Agent节点 */}
          {agentNodes.map((agent, index) => {
            const angle = (index / agentNodes.length) * 2 * Math.PI - Math.PI / 2
            const radius = 80
            const x = Math.cos(angle) * radius
            const y = Math.sin(angle) * radius

            return (
              <div
                key={agent.id}
                className="absolute"
                style={{
                  left: `calc(50% + ${x}px)`,
                  top: `calc(50% + ${y}px)`,
                  transform: 'translate(-50%, -50%)'
                }}
              >
                {/* 连接线 */}
                <svg
                  className="absolute"
                  style={{
                    left: -x,
                    top: -y,
                    width: Math.abs(x),
                    height: Math.abs(y)
                  }}
                >
                  <line
                    x1={x < 0 ? Math.abs(x) : 0}
                    y1={y < 0 ? Math.abs(y) : 0}
                    x2={x < 0 ? 0 : Math.abs(x)}
                    y2={y < 0 ? 0 : Math.abs(y)}
                    stroke={agent.status === 'running' ? '#60A5FA' : '#9CA3AF'}
                    strokeWidth="2"
                    strokeDasharray={agent.status === 'running' ? '5,5' : 'none'}
                    className={agent.status === 'running' ? 'animate-pulse' : ''}
                  />
                </svg>

                {/* Agent节点 */}
                <div className={`w-10 h-10 rounded-full flex items-center justify-center text-lg ${
                  STATUS_STYLES[agent.status].bg
                } border-2 ${
                  STATUS_STYLES[agent.status].border
                } ${
                  STATUS_STYLES[agent.status].glow ? 'shadow-lg shadow-blue-500/50' : ''
                }`}>
                  {AGENT_AVATARS[index % AGENT_AVATARS.length]}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// Agent卡片组件
function AgentCard({
  agent,
  avatar,
  thinkingDots
}: {
  agent: AgentNode
  avatar: string
  thinkingDots: string
}) {
  const style = STATUS_STYLES[agent.status]

  return (
    <div
      className={`rounded-lg border-2 p-3 transition-all duration-300 ${
        style.bg
      } ${style.border} ${
        style.glow ? 'shadow-lg' : ''
      }`}
    >
      {/* Agent头像和名称 */}
      <div className="flex items-center gap-2 mb-2">
        <div className={`text-2xl ${style.pulse ? 'animate-bounce' : ''}`}>
          {avatar}
        </div>
        <div>
          <div className="font-medium text-sm">{agent.name}</div>
          <div className="text-xs text-gray-500">{agent.id.slice(0, 8)}</div>
        </div>
      </div>

      {/* 思考过程 */}
      {agent.isThinking && (
        <div className="bg-blue-100 dark:bg-blue-900/30 rounded p-2 text-xs">
          <div className="flex items-center gap-1 text-blue-600 dark:text-blue-400">
            <span className="inline-block w-2 h-2 bg-blue-500 rounded-full animate-pulse"></span>
            <span className="font-medium">Thinking{thinkingDots}</span>
          </div>
          <div className="mt-1 text-gray-700 dark:text-gray-300">
            {agent.thinking[Math.floor(Math.random() * agent.thinking.length)]}
          </div>
        </div>
      )}

      {/* 状态标签 */}
      <div className="mt-2">
        <span className={`text-xs px-2 py-1 rounded ${
          agent.status === 'success' ? 'bg-green-200 text-green-800' :
          agent.status === 'failed' ? 'bg-red-200 text-red-800' :
          agent.status === 'running' ? 'bg-blue-200 text-blue-800' :
          'bg-gray-200 text-gray-800'
        }`}>
          {agent.status}
        </span>
      </div>
    </div>
  )
}

// 获取思考消息
function getThinkingMessages(status: SubTaskStatus, taskDescription: string): string[] {
  if (status !== 'running') return []

  return [
    `Analyzing: "${taskDescription.slice(0, 30)}..."`,
    'Processing task requirements...',
    'Executing subtask logic...',
    'Generating response...',
    'Verifying output quality...'
  ]
}
