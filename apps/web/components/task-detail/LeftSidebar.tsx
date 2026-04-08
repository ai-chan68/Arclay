/**
 * Left Sidebar - 任务列表
 */

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { cn } from '@/shared/lib/utils'
import { getFileSystem } from '@/shared/fs'
import { useWorkspace } from '@/shared/workspace/workspace-store'
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
  FolderOpen,
  RotateCcw,
} from 'lucide-react'
import { isTauri, type Task, type AgentMessage } from '@shared-types'
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

type WorkspaceDialogMode = 'create' | 'edit_default_dir' | 'delete' | null

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
  const {
    isReady: isWorkspaceReady,
    workspaces,
    currentWorkspaceId,
    currentWorkspace,
    switchWorkspace,
    createWorkspace,
    updateCurrentWorkspace,
    deleteCurrentWorkspace,
  } = useWorkspace()
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [workspaceDialogMode, setWorkspaceDialogMode] = useState<WorkspaceDialogMode>(null)
  const [workspaceNameDraft, setWorkspaceNameDraft] = useState('')
  const [workspaceDefaultDirDraft, setWorkspaceDefaultDirDraft] = useState('')
  const [workspaceDialogError, setWorkspaceDialogError] = useState<string | null>(null)
  const [isWorkspaceSaving, setIsWorkspaceSaving] = useState(false)

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

  const openCreateWorkspaceDialog = () => {
    setWorkspaceDialogMode('create')
    setWorkspaceNameDraft('')
    setWorkspaceDefaultDirDraft(currentWorkspace?.default_work_dir || '')
    setWorkspaceDialogError(null)
  }

  const openEditWorkspaceDialog = () => {
    if (!currentWorkspace) return
    setWorkspaceDialogMode('edit_default_dir')
    setWorkspaceNameDraft(currentWorkspace.name)
    setWorkspaceDefaultDirDraft(currentWorkspace.default_work_dir || '')
    setWorkspaceDialogError(null)
  }

  const openDeleteWorkspaceDialog = () => {
    if (!currentWorkspace || workspaces.length <= 1) return
    setWorkspaceDialogMode('delete')
    setWorkspaceNameDraft(currentWorkspace.name)
    setWorkspaceDefaultDirDraft(currentWorkspace.default_work_dir || '')
    setWorkspaceDialogError(null)
  }

  const closeWorkspaceDialog = (force = false) => {
    if (!force && isWorkspaceSaving) return
    setWorkspaceDialogMode(null)
    setWorkspaceNameDraft('')
    setWorkspaceDefaultDirDraft('')
    setWorkspaceDialogError(null)
  }

  const handlePickWorkspaceDirectory = async () => {
    try {
      setWorkspaceDialogError(null)
      if (isTauri()) {
        const fs = getFileSystem()
        const selectedPath = await fs.pickDirectory()
        if (selectedPath) {
          setWorkspaceDefaultDirDraft(selectedPath)
        }
        return
      }

      await new Promise<void>((resolve) => {
        const input = document.createElement('input')
        input.type = 'file'
        ;(input as HTMLInputElement & { webkitdirectory?: boolean }).webkitdirectory = true
        input.onchange = (event) => {
          const files = (event.target as HTMLInputElement).files
          if (files && files.length > 0) {
            const relativePath = files[0].webkitRelativePath
            if (relativePath) {
              const pathParts = relativePath.split('/')
              pathParts.pop()
              const dirPath = pathParts.join('/')
              setWorkspaceDefaultDirDraft(dirPath)
            }
          }
          resolve()
        }
        input.oncancel = () => resolve()
        input.click()
      })
    } catch (error) {
      console.error('[LeftSidebar] Failed to pick workspace directory:', error)
      setWorkspaceDialogError(error instanceof Error ? error.message : '无法选择目录')
    }
  }

  const handleClearWorkspaceDirectory = () => {
    setWorkspaceDefaultDirDraft('')
    setWorkspaceDialogError(null)
  }

  const handleSaveWorkspaceDialog = async () => {
    try {
      setIsWorkspaceSaving(true)
      setWorkspaceDialogError(null)
      const defaultWorkDir = workspaceDefaultDirDraft.trim() || null

      if (workspaceDialogMode === 'create') {
        const nextName = workspaceNameDraft.trim()
        if (!nextName) {
          setWorkspaceDialogError('请输入工作区名称')
          return
        }

        await createWorkspace(nextName, {
          defaultWorkDir,
          switchToNewWorkspace: true,
        })
      } else if (workspaceDialogMode === 'edit_default_dir') {
        await updateCurrentWorkspace({
          default_work_dir: defaultWorkDir,
        })
      } else if (workspaceDialogMode === 'delete') {
        await deleteCurrentWorkspace()
      }

      closeWorkspaceDialog(true)
    } catch (error) {
      console.error('[LeftSidebar] Failed to save workspace dialog:', error)
      setWorkspaceDialogError(error instanceof Error ? error.message : '保存工作区失败')
    } finally {
      setIsWorkspaceSaving(false)
    }
  }

  const fallbackWorkspace = workspaces.find((workspace) => workspace.id !== currentWorkspaceId) ?? null
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
            aria-label="设置"
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

      <div className="px-4 pb-3">
        <div className="ew-card rounded-2xl px-3 py-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="ew-subtext text-xs">工作区</span>
            <button
              onClick={openCreateWorkspaceDialog}
              className="ew-icon-btn rounded-lg p-1"
              title="新建工作区"
              aria-label="新建工作区"
            >
              <Plus className="size-3.5" />
            </button>
          </div>
          <select
            value={currentWorkspaceId || ''}
            onChange={(e) => switchWorkspace(e.target.value)}
            disabled={!isWorkspaceReady || workspaces.length === 0}
            aria-label="工作区切换"
            className="ew-select h-9 w-full rounded-xl px-3 text-sm outline-none"
          >
            {workspaces.map((workspace) => (
              <option key={workspace.id} value={workspace.id}>
                {workspace.name}
              </option>
            ))}
          </select>
          <div className="mt-2 flex items-center gap-2">
            <button
              onClick={openEditWorkspaceDialog}
              disabled={!currentWorkspace}
              aria-label="编辑工作区默认目录"
              className="ew-subtext rounded-lg border border-border px-2.5 py-1.5 text-xs transition-colors hover:bg-[color:color-mix(in_oklab,var(--ui-accent-soft)_50%,transparent)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              编辑目录
            </button>
            {workspaces.length > 1 && (
              <button
                onClick={openDeleteWorkspaceDialog}
                className="rounded-lg border border-red-200 px-2.5 py-1.5 text-xs text-red-600 transition-colors hover:bg-red-50"
              >
                删除工作区
              </button>
            )}
          </div>
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
          aria-label="设置"
        >
          <Settings className="size-4" />
          <span>设置</span>
        </button>
      </div>
    </div>
    <SettingsModal isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} />
    {workspaceDialogMode && (
      <div className="fixed inset-0 z-50 flex items-center justify-center">
        <div className="absolute inset-0 bg-black/35" onClick={() => closeWorkspaceDialog()} />
        <div
          className="ew-settings-shell relative z-10 flex w-[min(520px,92vw)] flex-col rounded-xl"
          role="dialog"
          aria-modal="true"
          aria-label={
            workspaceDialogMode === 'create'
              ? '新建工作区'
              : workspaceDialogMode === 'delete'
                ? '删除工作区'
                : '设置工作区默认目录'
          }
        >
          <div className="ew-settings-header flex items-center justify-between px-6 py-4">
            <div>
              <h2 className="ew-text text-lg font-semibold">
                {workspaceDialogMode === 'create'
                  ? '新建工作区'
                  : workspaceDialogMode === 'delete'
                    ? '删除工作区'
                    : '设置工作区默认目录'}
              </h2>
              <p className="ew-subtext text-sm">
                {workspaceDialogMode === 'create'
                  ? '为独立任务视图创建新的工作区'
                  : workspaceDialogMode === 'delete'
                    ? `删除后，任务和定时任务会转移到「${fallbackWorkspace?.name || '默认工作区'}」`
                  : `更新「${currentWorkspace?.name || workspaceNameDraft}」的默认目录`}
              </p>
            </div>
          </div>

          <div className="space-y-4 px-6 py-5">
            {workspaceDialogMode === 'create' && (
              <div>
                <label htmlFor="workspace-name" className="mb-1.5 block text-sm font-medium ew-text">
                  工作区名称
                </label>
                <input
                  id="workspace-name"
                  value={workspaceNameDraft}
                  onChange={(e) => setWorkspaceNameDraft(e.target.value)}
                  placeholder="例如：客户A / 个人项目 / 研究空间"
                  className="ew-input h-10 w-full rounded-lg px-3 text-sm"
                />
              </div>
            )}

            {workspaceDialogMode !== 'delete' && (
              <div>
                <label htmlFor="workspace-default-dir" className="mb-1.5 block text-sm font-medium ew-text">
                  默认目录
                </label>
                <div className="space-y-2">
                  <input
                    id="workspace-default-dir"
                    value={workspaceDefaultDirDraft}
                    onChange={(e) => setWorkspaceDefaultDirDraft(e.target.value)}
                    readOnly={isTauri()}
                    placeholder="不填则沿用系统默认目录"
                    className="ew-input h-10 w-full rounded-lg px-3 text-sm"
                  />
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void handlePickWorkspaceDirectory()}
                      className="ew-control ew-subtext flex items-center gap-1 rounded-lg px-3 py-2 text-sm hover:text-[color:var(--ui-text)]"
                    >
                      <FolderOpen className="size-4" />
                      选择目录
                    </button>
                    <button
                      type="button"
                      onClick={handleClearWorkspaceDirectory}
                      disabled={!workspaceDefaultDirDraft}
                      className="ew-control ew-subtext flex items-center gap-1 rounded-lg px-3 py-2 text-sm hover:text-[color:var(--ui-text)] disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <RotateCcw className="size-4" />
                      清空
                    </button>
                  </div>
                </div>
                <p className="ew-subtext mt-1 text-xs">
                  仅影响这个工作区中新任务的默认启动目录。
                </p>
              </div>
            )}

            {workspaceDialogMode === 'delete' && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                <p>将删除「{currentWorkspace?.name || workspaceNameDraft}」。</p>
                <p className="mt-1">
                  其中的任务归属和定时任务会自动转移到「{fallbackWorkspace?.name || '默认工作区'}」，不会直接丢失。
                </p>
              </div>
            )}

            {workspaceDialogError && (
              <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
                {workspaceDialogError}
              </div>
            )}
          </div>

          <div className="flex items-center justify-end gap-2 border-t border-border px-6 py-4">
            <button
              onClick={() => closeWorkspaceDialog()}
              disabled={isWorkspaceSaving}
              className="ew-button-ghost rounded-lg px-3 py-2 text-sm"
            >
              取消
            </button>
            <button
              onClick={handleSaveWorkspaceDialog}
              disabled={isWorkspaceSaving}
              className={cn(
                'rounded-lg px-3 py-2 text-sm',
                workspaceDialogMode === 'delete'
                  ? 'bg-red-600 text-white hover:bg-red-700'
                  : 'ew-button-primary'
              )}
            >
              {workspaceDialogMode === 'create'
                ? '创建工作区'
                : workspaceDialogMode === 'delete'
                  ? '删除并迁移任务'
                  : '保存默认目录'}
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  )
}
