/**
 * Left Sidebar - 任务列表
 */

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { cn } from '@/shared/lib/utils'
import {
  PanelLeftClose,
  PanelLeft,
  Plus,
  List,
  Trash2,
  MessageSquare,
  Clock,
  Settings,
  CalendarClock,
  AlertCircle,
} from 'lucide-react'
import type { Task, AgentMessage } from '@shared-types'
import { SettingsModal } from './SettingsModal'

// Extended Task type for UI with additional fields
export interface UITask extends Task {
  title: string
  phase: 'idle' | 'analyzing' | 'planning' | 'awaiting_approval' | 'awaiting_clarification' | 'blocked' | 'executing'
  selectedArtifactId: string | null
  previewMode: 'static' | 'live'
  isRightSidebarVisible: boolean
  messages?: AgentMessage[]
  hasMessageHistory?: boolean | null
}

interface LeftSidebarProps {
  tasks: UITask[]
  currentTaskId?: string
  onSelectTask: (id: string) => void
  onNewTask: () => void
  onDeleteTask: (id: string) => void
  // Reserved for future favorite feature rollout.
  onToggleFavorite: (id: string, favorite: boolean) => void
  runningTaskIds?: string[]
  isCollapsed?: boolean
  onToggleCollapse?: () => void
  onOpenSettings?: () => void
}

export function LeftSidebar({
  tasks,
  currentTaskId,
  onSelectTask,
  onNewTask,
  onDeleteTask,
  isCollapsed = false,
  onToggleCollapse,
  onOpenSettings,
}: LeftSidebarProps) {
  const navigate = useNavigate()
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)

  // 按创建时间降序排序（最新创建的任务优先）
  const sortedTasks = [...tasks].sort((a, b) => {
    const aTime = new Date(a.created_at || a.updated_at).getTime()
    const bTime = new Date(b.created_at || b.updated_at).getTime()
    return bTime - aTime
  })

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr)
    const now = new Date()
    const diff = now.getTime() - date.getTime()
    const days = Math.floor(diff / (1000 * 60 * 60 * 24))

    if (days === 0) {
      return '今天'
    } else if (days === 1) {
      return '昨天'
    } else if (days < 7) {
      return `${days}天前`
    } else {
      return date.toLocaleDateString('zh-CN')
    }
  }

  if (isCollapsed) {
    return (
      <>
        <div className="ew-sidebar flex h-full w-14 flex-col items-center py-4">
          <button
            onClick={onToggleCollapse}
            className="ew-icon-btn mb-4 rounded-lg p-2"
            title="展开侧边栏"
          >
            <PanelLeft className="size-5" />
          </button>
          <button
            onClick={onNewTask}
            className="ew-icon-btn mb-4 rounded-lg p-2"
            title="新建任务"
          >
            <Plus className="size-5" />
          </button>
          <button
            onClick={() => navigate('/library')}
            className="ew-icon-btn mb-4 rounded-lg p-2"
            title="任务库"
          >
            <List className="size-5" />
          </button>
          <button
            onClick={() => navigate('/scheduled-tasks')}
            className="ew-icon-btn mb-4 rounded-lg p-2"
            title="定时任务"
          >
            <CalendarClock className="size-5" />
          </button>
          <div className="flex-1 space-y-2 overflow-y-auto">
            {sortedTasks.slice(0, 5).map((task) => (
              <button
                key={task.id}
                onClick={() => onSelectTask(task.id)}
                className={cn(
                  'rounded-lg p-2 transition-colors ew-list-item',
                  currentTaskId === task.id
                    ? 'active'
                    : ''
                )}
                title={task.title}
              >
                <MessageSquare className="size-5" />
              </button>
            ))}
          </div>
          {/* Settings button in collapsed mode */}
          <button
            onClick={() => setIsSettingsOpen(true)}
            className="ew-icon-btn mt-2 rounded-lg p-2"
            title="设置"
          >
            <Settings className="size-5" />
          </button>
        </div>
        <SettingsModal isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} />
      </>
    )
  }

  return (
    <>
    <div className="ew-sidebar flex h-full w-64 flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-4">
        <h2 className="ew-title text-sm font-semibold">
          任务历史
        </h2>
        <div className="flex items-center gap-1">
          <button
            onClick={onNewTask}
            className="ew-icon-btn rounded-lg p-1.5"
            title="新建任务"
          >
            <Plus className="size-4" />
          </button>
          <button
            onClick={() => navigate('/library')}
            className="ew-icon-btn rounded-lg p-1.5"
            title="任务库"
          >
            <List className="size-4" />
          </button>
          <button
            onClick={() => navigate('/scheduled-tasks')}
            className="ew-icon-btn rounded-lg p-1.5"
            title="定时任务"
          >
            <CalendarClock className="size-4" />
          </button>
          <button
            onClick={onToggleCollapse}
            className="ew-icon-btn rounded-lg p-1.5"
            title="收起侧边栏"
          >
            <PanelLeftClose className="size-4" />
          </button>
        </div>
      </div>

      {/* Task List */}
      <div className="flex-1 overflow-y-auto px-3 pb-3">
        {sortedTasks.length === 0 ? (
          <div className="ew-subtext flex h-32 flex-col items-center justify-center">
            <MessageSquare className="mb-2 size-8" />
            <p className="text-sm">暂无任务</p>
          </div>
        ) : (
          <div className="space-y-2">
            {sortedTasks.map((task) => {
              const hasMissingHistory = task.hasMessageHistory === false && task.status !== 'running'
              return (
                <div
                  key={task.id}
                  className={cn(
                    'ew-list-item group relative cursor-pointer rounded-2xl px-3 py-3 transition-colors',
                    currentTaskId === task.id
                      ? 'active'
                      : ''
                  )}
                  onClick={() => onSelectTask(task.id)}
                >
                  <div className="flex items-start gap-2">
                    {/* Content */}
                    <div className="min-w-0 flex-1 pr-10">
                      <div className="flex items-center gap-1.5">
                        <p className="ew-text truncate text-sm">
                          {task.title}
                        </p>
                        {hasMissingHistory && (
                          <span
                            className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-300"
                            title="该任务只有任务记录，缺少历史消息"
                          >
                            <AlertCircle className="size-3" />
                            缺消息
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5 flex items-center gap-1 text-xs ew-subtext">
                        <Clock className="size-3" />
                        <span>{formatDate(task.created_at)}</span>
                      </div>
                    </div>
                  </div>

                  {/* Hover Actions */}
                  <div
                    className={cn(
                      'absolute right-2 top-2 flex items-center gap-1 transition-opacity duration-150',
                      'opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto',
                      currentTaskId === task.id && 'opacity-100 pointer-events-auto'
                    )}
                  >
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        onDeleteTask(task.id)
                      }}
                      className="ew-subtext rounded p-1 hover:bg-red-100/40 hover:text-red-500"
                      title="删除"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Settings button at bottom */}
      <div className="px-3 pb-3 pt-2">
        <button
          onClick={() => setIsSettingsOpen(true)}
          className="ew-card flex w-full items-center gap-2 rounded-2xl px-3 py-2.5 text-sm transition-colors hover:bg-[color:color-mix(in_oklab,var(--ui-accent-soft)_62%,var(--ui-panel))]"
        >
          <Settings className="size-4" />
          <span>设置</span>
        </button>
      </div>
    </div>
    <SettingsModal isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} />
    </>
  )
}
