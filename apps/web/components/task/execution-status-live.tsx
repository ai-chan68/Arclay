/**
 * ExecutionStatusLive - 实时执行状态显示
 *
 * 在任务执行过程中实时显示当前阶段和进度
 * 即使没有subtasks也能展示状态
 */

import React, { useState, useEffect } from 'react'
import type { MultiAgentPhase, MultiAgentProgress } from '@shared-types'

export interface ExecutionStatusLiveProps {
  phase: MultiAgentPhase
  progress?: MultiAgentProgress
  isRunning: boolean
  className?: string
}

const PHASE_CONFIG: Record<MultiAgentPhase, {
  icon: string
  label: string
  description: string
  color: string
  bgGradient: string
}> = {
  analyzing: {
    icon: '🔍',
    label: 'Analyzing Task',
    description: 'Scanning task requirements and determining complexity...',
    color: 'from-blue-500 to-cyan-500',
    bgGradient: 'from-blue-50 to-cyan-50 dark:from-blue-900/20 dark:to-cyan-900/20'
  },
  decomposing: {
    icon: '🧩',
    label: 'Decomposing Task',
    description: 'Breaking down into parallel subtasks...',
    color: 'from-purple-500 to-pink-500',
    bgGradient: 'from-purple-50 to-pink-50 dark:from-purple-900/20 dark:to-pink-900/20'
  },
  executing: {
    icon: '⚡',
    label: 'Executing in Parallel',
    description: 'Multiple agents working simultaneously...',
    color: 'from-green-500 to-emerald-500',
    bgGradient: 'from-green-50 to-emerald-50 dark:from-green-900/20 dark:to-emerald-900/20'
  },
  aggregating: {
    icon: '🤝',
    label: 'Aggregating Results',
    description: 'Combining outputs from all agents...',
    color: 'from-yellow-500 to-orange-500',
    bgGradient: 'from-yellow-50 to-orange-50 dark:from-yellow-900/20 dark:to-orange-900/20'
  },
  completed: {
    icon: '✨',
    label: 'Completed',
    description: 'All tasks finished successfully!',
    color: 'from-green-500 to-teal-500',
    bgGradient: 'from-green-50 to-teal-50 dark:from-green-900/20 dark:to-teal-900/20'
  }
}

export function ExecutionStatusLive({
  phase,
  progress,
  isRunning,
  className = ''
}: ExecutionStatusLiveProps) {
  const [animatedDots, setAnimatedDots] = useState('')
  const [particles, setParticles] = useState<Array<{ id: number; x: number; delay: number }>>([])

  // 动态点点点动画
  useEffect(() => {
    if (!isRunning) {
      setAnimatedDots('')
      return
    }

    const interval = setInterval(() => {
      setAnimatedDots(prev => prev.length >= 3 ? '' : prev + '.')
    }, 500)

    return () => clearInterval(interval)
  }, [isRunning])

  // 粒子效果
  useEffect(() => {
    if (!isRunning || phase !== 'executing') {
      setParticles([])
      return
    }

    const interval = setInterval(() => {
      const newParticle = {
        id: Date.now(),
        x: Math.random() * 100,
        delay: Math.random() * 2
      }
      setParticles(prev => [...prev.slice(-10), newParticle])
    }, 500)

    return () => clearInterval(interval)
  }, [isRunning, phase])

  const config = PHASE_CONFIG[phase]
  const progressPercent = progress ? Math.round((progress.completed / progress.total) * 100) : 0

  if (!isRunning && phase !== 'completed') {
    return null
  }

  return (
    <div className={`relative overflow-hidden ${className}`}>
      {/* 背景动画 */}
      <div className={`absolute inset-0 bg-gradient-to-br ${config.bgGradient} opacity-50`}></div>

      {/* 粒子效果（仅在executing阶段） */}
      {phase === 'executing' && particles.map(particle => (
        <div
          key={particle.id}
          className="absolute w-2 h-2 bg-green-400 rounded-full opacity-60 animate-ping"
          style={{
            left: `${particle.x}%`,
            bottom: 0,
            animationDelay: `${particle.delay}s`
          }}
        />
      ))}

      {/* 主要内容 */}
      <div className="relative z-10 p-8">
        {/* 大图标 */}
        <div className="text-center mb-6">
          <div className={`inline-block text-8xl ${isRunning ? 'animate-bounce' : ''}`}>
            {config.icon}
          </div>
        </div>

        {/* 阶段标题 */}
        <div className="text-center mb-4">
          <h2 className={`text-3xl font-bold bg-gradient-to-r ${config.color} bg-clip-text text-transparent mb-2`}>
            {config.label}{animatedDots}
          </h2>
          <p className="text-gray-600 dark:text-gray-400">
            {config.description}
          </p>
        </div>

        {/* 进度条 */}
        {progress && progress.total > 0 && (
          <div className="mt-6">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-gray-600 dark:text-gray-400">
                Progress
              </span>
              <span className="text-sm font-medium text-gray-800 dark:text-gray-200">
                {progress.completed}/{progress.total} ({progressPercent}%)
              </span>
            </div>

            {/* 进度条 */}
            <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-3 overflow-hidden">
              <div
                className={`h-3 rounded-full bg-gradient-to-r ${config.color} transition-all duration-500 ${isRunning ? 'animate-pulse' : ''}`}
                style={{ width: `${progressPercent}%` }}
              />
            </div>

            {/* 实时统计 */}
            <div className="grid grid-cols-3 gap-4 mt-4">
              <div className="text-center">
                <div className="text-2xl font-bold text-blue-600 dark:text-blue-400">
                  {progress.running}
                </div>
                <div className="text-xs text-gray-500">Running</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-green-600 dark:text-green-400">
                  {progress.completed}
                </div>
                <div className="text-xs text-gray-500">Completed</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-red-600 dark:text-red-400">
                  {progress.failed}
                </div>
                <div className="text-xs text-gray-500">Failed</div>
              </div>
            </div>
          </div>
        )}

        {/* 思考动画 */}
        {isRunning && (
          <div className="mt-6 flex items-center justify-center gap-2">
            <div className="flex gap-1">
              <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
              <div className="w-2 h-2 bg-purple-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
              <div className="w-2 h-2 bg-pink-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
            </div>
            <span className="text-sm text-gray-500 dark:text-gray-400 ml-2">
              Processing...
            </span>
          </div>
        )}

        {/* 阶段指示器 */}
        <div className="mt-8">
          <div className="flex items-center justify-center gap-2">
            {(['analyzing', 'decomposing', 'executing', 'aggregating', 'completed'] as MultiAgentPhase[]).map((p, index) => {
              const isActive = p === phase
              const isPast = ['analyzing', 'decomposing', 'executing', 'aggregating', 'completed'].indexOf(p) <
                            ['analyzing', 'decomposing', 'executing', 'aggregating', 'completed'].indexOf(phase)

              return (
                <React.Fragment key={p}>
                  {index > 0 && (
                    <div className={`h-0.5 w-8 ${isPast ? 'bg-green-500' : 'bg-gray-300 dark:bg-gray-600'}`} />
                  )}
                  <div
                    className={`w-3 h-3 rounded-full ${
                      isActive
                        ? `bg-gradient-to-r ${config.color} animate-pulse`
                        : isPast
                        ? 'bg-green-500'
                        : 'bg-gray-300 dark:bg-gray-600'
                    }`}
                  />
                </React.Fragment>
              )
            })}
          </div>
          <div className="flex items-center justify-center gap-4 mt-2">
            {['🔍', '🧩', '⚡', '🤝', '✨'].map((emoji, index) => (
              <div
                key={index}
                className={`text-sm ${
                  index === ['analyzing', 'decomposing', 'executing', 'aggregating', 'completed'].indexOf(phase)
                    ? 'opacity-100'
                    : index < ['analyzing', 'decomposing', 'executing', 'aggregating', 'completed'].indexOf(phase)
                    ? 'opacity-60'
                    : 'opacity-30'
                }`}
              >
                {emoji}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
