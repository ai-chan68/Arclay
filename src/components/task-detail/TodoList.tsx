/**
 * TodoList - 任务进度追踪组件
 */

import { useState, useEffect } from 'react'
import { CheckCircle2, Circle, Loader2, XCircle, AlertCircle } from 'lucide-react'
import { cn } from '@/shared/lib/utils'

interface TodoItem {
  id: string
  content: string
  status: 'pending' | 'in_progress' | 'completed' | 'failed'
  reason?: string
}

interface TodoListProps {
  taskId: string
  workDir?: string
}

export function TodoList({ taskId, workDir }: TodoListProps) {
  const [todos, setTodos] = useState<TodoItem[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (taskId) {
      loadTodos()
      // Poll for updates every 2 seconds
      const interval = setInterval(loadTodos, 2000)
      return () => clearInterval(interval)
    }
  }, [taskId])

  const loadTodos = async () => {
    try {
      const params = new URLSearchParams()
      if (workDir) params.set('workDir', workDir)

      const response = await fetch(`/api/tasks/${taskId}/todos?${params}`)
      if (!response.ok) return

      const data = await response.json()
      if (data.todos && Array.isArray(data.todos)) {
        setTodos(data.todos)
      }
    } catch (err) {
      console.error('Failed to load todos:', err)
    }
  }

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed':
        return <CheckCircle2 className="size-4 text-emerald-500" />
      case 'in_progress':
        return <Loader2 className="size-4 animate-spin text-blue-500" />
      case 'failed':
        return <XCircle className="size-4 text-red-500" />
      default:
        return <Circle className="size-4 text-muted-foreground" />
    }
  }

  const getStatusText = (status: string) => {
    const map: Record<string, string> = {
      pending: '待处理',
      in_progress: '进行中',
      completed: '已完成',
      failed: '失败',
    }
    return map[status] || status
  }

  if (todos.length === 0) {
    return null
  }

  const completed = todos.filter(t => t.status === 'completed').length
  const total = todos.length
  const progress = total > 0 ? (completed / total) * 100 : 0

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">任务进度</h3>
        <span className="text-xs text-muted-foreground">
          {completed}/{total}
        </span>
      </div>

      {/* Progress bar */}
      <div className="h-2 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full bg-primary transition-all duration-300"
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* Todo items */}
      <div className="space-y-2">
        {todos.map((todo) => (
          <div
            key={todo.id}
            className={cn(
              'flex items-start gap-2 rounded-lg border border-border p-2 text-sm',
              todo.status === 'completed' && 'bg-emerald-50/50 dark:bg-emerald-900/10',
              todo.status === 'failed' && 'bg-red-50/50 dark:bg-red-900/10'
            )}
          >
            <div className="mt-0.5">{getStatusIcon(todo.status)}</div>
            <div className="flex-1 min-w-0">
              <div className={cn(
                'break-words',
                todo.status === 'completed' && 'text-muted-foreground line-through'
              )}>
                {todo.content}
              </div>
              {todo.reason && (
                <div className="mt-1 text-xs text-red-600 dark:text-red-400">
                  {todo.reason}
                </div>
              )}
            </div>
            <div className="shrink-0 text-xs text-muted-foreground">
              {getStatusText(todo.status)}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
