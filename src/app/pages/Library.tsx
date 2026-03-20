import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Clock, Search, SquareCheckBig, Trash2 } from 'lucide-react'
import { useSidebar } from '@/components/task-detail/SidebarContext'
import { LeftSidebar, type UITask } from '@/components/task-detail/LeftSidebar'
import { useDatabase } from '@/shared/hooks/useDatabase'
import { subscribeToBackgroundTasks, type BackgroundTask } from '@/shared/lib'
import { cn } from '@/shared/lib/utils'
import type { Task } from '@shared-types'

type TaskFilter = 'all' | 'favorite' | 'running' | 'completed' | 'error' | 'stopped'

export function LibraryPage() {
  return <LibraryContent />
}

function toUITask(task: Task): UITask {
  return {
    ...task,
    title: task.title || task.prompt.slice(0, 50) + (task.prompt.length > 50 ? '...' : ''),
    phase: 'idle',
    selectedArtifactId: null,
    previewMode: 'static',
    isRightSidebarVisible: false,
    messages: [],
  }
}

function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMin = Math.floor(diffMs / (1000 * 60))
  const diffHour = Math.floor(diffMs / (1000 * 60 * 60))
  const diffDay = Math.floor(diffMs / (1000 * 60 * 60 * 24))

  if (diffMin < 1) return '刚刚'
  if (diffMin < 60) return `${diffMin} 分钟前`
  if (diffHour < 24) return `${diffHour} 小时前`
  if (diffDay < 7) return `${diffDay} 天前`
  return date.toLocaleDateString('zh-CN')
}

function statusLabel(status: Task['status']): string {
  switch (status) {
    case 'running':
      return '运行中'
    case 'completed':
      return '已完成'
    case 'error':
      return '错误'
    case 'stopped':
      return '已停止'
    default:
      return '未知'
  }
}

function statusBadgeClass(status: Task['status']): string {
  switch (status) {
    case 'running':
      return 'ew-badge text-orange-600'
    case 'completed':
      return 'ew-badge text-emerald-600'
    case 'error':
      return 'ew-badge text-red-600'
    case 'stopped':
      return 'ew-badge text-yellow-700'
    default:
      return 'ew-badge'
  }
}

function LibraryContent() {
  const { isLeftOpen, toggleLeft } = useSidebar()
  const navigate = useNavigate()
  const { isReady, loadAllTasks, deleteTask, updateTask } = useDatabase()
  const [tasks, setTasks] = useState<Task[]>([])
  const [backgroundTasks, setBackgroundTasks] = useState<BackgroundTask[]>([])
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<TaskFilter>('all')
  const [isLoading, setIsLoading] = useState(true)
  const [selectMode, setSelectMode] = useState(false)
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<string>>(new Set())

  useEffect(() => subscribeToBackgroundTasks(setBackgroundTasks), [])

  const refreshTasks = useCallback(async () => {
    if (!isReady) return
    setIsLoading(true)
    try {
      const allTasks = await loadAllTasks()
      setTasks(allTasks)
    } catch (error) {
      console.error('[Library] Failed to load tasks:', error)
    } finally {
      setIsLoading(false)
    }
  }, [isReady, loadAllTasks])

  useEffect(() => {
    refreshTasks()
  }, [refreshTasks])

  const handleDeleteTask = useCallback(async (taskId: string) => {
    try {
      await deleteTask(taskId)
      setTasks((prev) => prev.filter((t) => t.id !== taskId))
      setSelectedTaskIds((prev) => {
        const next = new Set(prev)
        next.delete(taskId)
        return next
      })
    } catch (error) {
      console.error('[Library] Failed to delete task:', error)
    }
  }, [deleteTask])

  const handleToggleFavorite = useCallback(async (taskId: string, favorite: boolean) => {
    try {
      await updateTask(taskId, { favorite })
      setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, favorite } : t)))
    } catch (error) {
      console.error('[Library] Failed to toggle favorite:', error)
    }
  }, [updateTask])

  const handleSelectTask = useCallback((taskId: string) => {
    if (selectMode) {
      setSelectedTaskIds((prev) => {
        const next = new Set(prev)
        if (next.has(taskId)) {
          next.delete(taskId)
        } else {
          next.add(taskId)
        }
        return next
      })
      return
    }
    navigate(`/task/${taskId}`)
  }, [navigate, selectMode])

  const handleBulkDelete = useCallback(async () => {
    const ids = Array.from(selectedTaskIds)
    if (ids.length === 0) return
    if (!confirm(`确定删除选中的 ${ids.length} 个任务吗？`)) return

    try {
      await Promise.all(ids.map((id) => deleteTask(id)))
      setTasks((prev) => prev.filter((task) => !selectedTaskIds.has(task.id)))
      setSelectedTaskIds(new Set())
      setSelectMode(false)
    } catch (error) {
      console.error('[Library] Failed to bulk delete tasks:', error)
    }
  }, [deleteTask, selectedTaskIds])

  const filteredTasks = useMemo(() => {
    const query = search.trim().toLowerCase()

    return tasks
      .filter((task) => {
        if (!query) return true
        return task.prompt.toLowerCase().includes(query) || (task.title || '').toLowerCase().includes(query)
      })
      .filter((task) => {
        if (filter === 'all') return true
        if (filter === 'favorite') return !!task.favorite
        return task.status === filter
      })
      .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
  }, [filter, search, tasks])

  const stats = useMemo(() => {
    const running = tasks.filter((task) => task.status === 'running').length
    const completed = tasks.filter((task) => task.status === 'completed').length
    const error = tasks.filter((task) => task.status === 'error').length
    const favorite = tasks.filter((task) => task.favorite).length

    return {
      all: tasks.length,
      running,
      completed,
      error,
      favorite,
    }
  }, [tasks])

  const runningTaskIds = backgroundTasks.filter((t) => t.isRunning).map((t) => t.taskId)
  const sidebarTasks = useMemo(() => tasks.map(toUITask), [tasks])

  return (
    <div className="ew-shell flex h-screen overflow-hidden">
      <LeftSidebar
        tasks={sidebarTasks}
        onSelectTask={(id) => navigate(`/task/${id}`)}
        onNewTask={() => navigate('/')}
        onDeleteTask={handleDeleteTask}
        onToggleFavorite={handleToggleFavorite}
        runningTaskIds={runningTaskIds}
        isCollapsed={!isLeftOpen}
        onToggleCollapse={toggleLeft}
      />

      <main className="ew-main-panel my-2 mr-2 flex min-w-0 flex-1 flex-col overflow-hidden rounded-2xl">
        <div className="border-b border-border px-6 py-4">
          <h1 className="ew-title text-lg font-semibold">任务库</h1>
          <p className="ew-subtext mt-1 text-sm">查找历史任务并快速回到上下文</p>
        </div>

        <div className="border-b border-border px-6 py-4">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[280px] flex-1">
              <Search className="ew-subtext absolute left-3 top-1/2 size-4 -translate-y-1/2" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="搜索任务标题或内容..."
                className="ew-input h-10 w-full rounded-lg px-9 text-sm"
              />
            </div>

            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value as TaskFilter)}
              className="ew-select h-10 rounded-lg px-3 text-sm outline-none"
            >
              <option value="all">全部状态</option>
              <option value="favorite">仅收藏</option>
              <option value="running">运行中</option>
              <option value="completed">已完成</option>
              <option value="error">错误</option>
              <option value="stopped">已停止</option>
            </select>

            <button
              onClick={() => {
                setSelectMode((v) => !v)
                setSelectedTaskIds(new Set())
              }}
              className={cn(
                'inline-flex h-10 items-center gap-1.5 rounded-lg border px-3 text-sm',
                selectMode
                  ? 'ew-button-primary'
                  : 'ew-button-ghost'
              )}
            >
              <SquareCheckBig className="size-4" />
              {selectMode ? '取消选择' : '批量选择'}
            </button>

            {selectMode && selectedTaskIds.size > 0 && (
              <button
                onClick={handleBulkDelete}
                className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-red-500 px-3 text-sm font-medium text-white hover:bg-red-600"
              >
                <Trash2 className="size-4" />
                删除已选 ({selectedTaskIds.size})
              </button>
            )}
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              onClick={() => setFilter('all')}
              className={cn('ew-badge rounded-full px-2.5 py-1 text-xs', filter === 'all' && 'ew-highlight')}
            >
              全部 {stats.all}
            </button>
            <button
              onClick={() => setFilter('running')}
              className={cn('ew-badge rounded-full px-2.5 py-1 text-xs', filter === 'running' && 'ew-highlight')}
            >
              运行中 {stats.running}
            </button>
            <button
              onClick={() => setFilter('completed')}
              className={cn('ew-badge rounded-full px-2.5 py-1 text-xs', filter === 'completed' && 'ew-highlight')}
            >
              已完成 {stats.completed}
            </button>
            <button
              onClick={() => setFilter('error')}
              className={cn('ew-badge rounded-full px-2.5 py-1 text-xs', filter === 'error' && 'ew-highlight')}
            >
              错误 {stats.error}
            </button>
            <button
              onClick={() => setFilter('favorite')}
              className={cn('ew-badge rounded-full px-2.5 py-1 text-xs', filter === 'favorite' && 'ew-highlight')}
            >
              收藏 {stats.favorite}
            </button>
            {selectMode && (
              <span className="ew-subtext ml-auto text-xs">已选择 {selectedTaskIds.size} 项</span>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          {isLoading ? (
            <div className="ew-subtext flex items-center justify-center py-20 text-sm">
              加载任务中...
            </div>
          ) : filteredTasks.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <p className="ew-text text-base font-medium">没有匹配的任务</p>
              <p className="ew-subtext mt-1 text-sm">调整筛选条件或新建任务试试</p>
            </div>
          ) : (
            <div className="space-y-2">
              {filteredTasks.map((task) => {
                const isSelected = selectedTaskIds.has(task.id)
                return (
                  <button
                    key={task.id}
                    onClick={() => handleSelectTask(task.id)}
                    className={cn(
                      'w-full rounded-xl border p-4 text-left transition-colors',
                      isSelected
                        ? 'ew-list-item active'
                        : 'ew-list-item'
                    )}
                  >
                    <div className="flex items-start gap-3">
                      {selectMode && (
                        <div
                          className={cn(
                            'mt-0.5 size-5 rounded border-2',
                            isSelected ? 'border-orange-500 bg-orange-500' : 'border-border bg-transparent'
                          )}
                        />
                      )}

                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <h3 className="ew-text truncate text-sm font-medium">
                            {task.title || task.prompt || '未命名任务'}
                          </h3>
                          {task.favorite && (
                            <span className="rounded bg-yellow-100/70 px-1.5 py-0.5 text-xs text-yellow-700">
                              收藏
                            </span>
                          )}
                          <span className={cn('rounded px-1.5 py-0.5 text-xs', statusBadgeClass(task.status))}>
                            {statusLabel(task.status)}
                          </span>
                        </div>

                        <p className="ew-subtext mt-1 line-clamp-2 text-sm">{task.prompt}</p>

                        <div className="ew-subtext mt-2 flex items-center gap-4 text-xs">
                          <span className="inline-flex items-center gap-1">
                            <Clock className="size-3.5" />
                            {formatRelativeTime(task.updated_at || task.created_at)}
                          </span>
                          <span>ID: {task.id.slice(0, 16)}...</span>
                        </div>
                      </div>

                      {!selectMode && (
                        <div className="flex items-center gap-1">
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              handleToggleFavorite(task.id, !task.favorite)
                            }}
                            className="ew-icon-btn rounded px-2 py-1 text-xs"
                          >
                            {task.favorite ? '取消收藏' : '收藏'}
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              handleDeleteTask(task.id)
                            }}
                            className="rounded px-2 py-1 text-xs text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
                          >
                            删除
                          </button>
                        </div>
                      )}
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
