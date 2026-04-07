/**
 * Home - 首页
 *
 * 参考当前产品设计：左侧任务列表 + 居中输入框
 * 用户输入 prompt → 创建 session → 生成 taskId → 导航到 /task/:taskId
 */

import { useEffect, useState, useCallback, useRef } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { Bot } from 'lucide-react'

import { useSidebar } from '@/components/task-detail/SidebarContext'
import { LeftSidebar, type UITask } from '@/components/task-detail/LeftSidebar'
import { ChatInput } from '@/components/task-detail/ChatInput'
import { useDatabase } from '@/shared/hooks/useDatabase'
import type { MessageAttachment } from '@shared-types'
import {
  generateSessionId,
  generateTaskId,
  subscribeToBackgroundTasks,
  type BackgroundTask,
} from '@/shared/lib'

interface HomeLocationState {
  prompt?: string
  attachments?: MessageAttachment[]
}

const QUICK_START_PROMPTS = [
  '整理今天的工作计划，并按优先级给出可执行清单',
  '读取项目代码并总结最近最值得优化的 5 个点',
  '帮我设计一个周报模板，并自动填充关键指标占位符',
]

export function HomePage() {
  return <HomeContent />
}

function HomeContent() {
  const { isLeftOpen, toggleLeft } = useSidebar()
  const [tasks, setTasks] = useState<UITask[]>([])
  const [backgroundTasks, setBackgroundTasks] = useState<BackgroundTask[]>([])
  const navigate = useNavigate()
  const location = useLocation()
  const initialPromptHandledRef = useRef(false)
  const { isReady, loadAllTasks, deleteTask, updateTask } = useDatabase()

  // Subscribe to background tasks
  useEffect(() => {
    return subscribeToBackgroundTasks(setBackgroundTasks)
  }, [])

  // Load tasks for sidebar - 每次导航到首页时重新加载
  useEffect(() => {
    if (!isReady) return
    async function load() {
      try {
        console.log('[Home] Loading all tasks from DB...')
        const allTasks = await loadAllTasks()
        console.log('[Home] Loaded tasks:', allTasks.length)
        setTasks(allTasks.map(t => ({
          ...t,
          title: t.prompt.slice(0, 50) + (t.prompt.length > 50 ? '...' : ''),
          phase: 'idle' as const,
          selectedArtifactId: null,
          previewMode: 'static' as const,
          isRightSidebarVisible: false,
          messages: [],
        })))
      } catch (error) {
        console.error('[Home] Failed to load tasks:', error)
      }
    }
    load()
  }, [isReady, loadAllTasks, location.pathname])
  const handleDeleteTask = useCallback(async (taskId: string) => {
    try {
      await deleteTask(taskId)
      setTasks(prev => prev.filter(t => t.id !== taskId))
    } catch (error) {
      console.error('[Home] Failed to delete task:', error)
    }
  }, [deleteTask])

  const handleToggleFavorite = useCallback(async (taskId: string, favorite: boolean) => {
    try {
      await updateTask(taskId, { favorite })
      setTasks(prev => prev.map(t => t.id === taskId ? { ...t, favorite } : t))
    } catch (error) {
      console.error('[Home] Failed to toggle favorite:', error)
    }
  }, [updateTask])

  const handleSubmit = useCallback((text: string, attachments?: MessageAttachment[]) => {
    if (!text.trim() && (!attachments || attachments.length === 0)) return

    const prompt = text.trim()
    const sessionId = generateSessionId()
    const taskIndex = 1
    const taskId = generateTaskId(sessionId, taskIndex)

    navigate(`/task/${taskId}`, {
      state: {
        prompt,
        sessionId,
        taskIndex,
        attachments,
      },
    })
  }, [navigate])

  // Handle quick-start prompt from Welcome page
  useEffect(() => {
    const state = location.state as HomeLocationState | null
    const prompt = state?.prompt?.trim()
    if (!prompt || initialPromptHandledRef.current) return
    initialPromptHandledRef.current = true
    handleSubmit(prompt, state?.attachments)
  }, [location.state, handleSubmit])

  const handleSelectTask = useCallback((id: string) => {
    navigate(`/task/${id}`)
  }, [navigate])

  const handleNewTask = useCallback(() => {
    navigate('/')
  }, [navigate])

  const runningTaskIds = backgroundTasks
    .filter(t => t.isRunning)
    .map(t => t.taskId)

  return (
    <div className="ew-shell flex h-screen overflow-hidden">
      {/* Left Sidebar */}
      <LeftSidebar
        tasks={tasks}
        onSelectTask={handleSelectTask}
        onNewTask={handleNewTask}
        onDeleteTask={handleDeleteTask}
        onToggleFavorite={handleToggleFavorite}
        runningTaskIds={runningTaskIds}
        isCollapsed={!isLeftOpen}
        onToggleCollapse={toggleLeft}
      />

      {/* Main Content */}
      <div className="ew-main-panel my-2 mr-2 flex min-w-0 flex-1 flex-col overflow-hidden rounded-2xl">
        <div className="flex flex-1 flex-col items-center justify-center overflow-auto px-4">
          <div className="flex w-full max-w-2xl flex-col items-center gap-6">
            {/* Logo & Title */}
            <div className="flex flex-col items-center gap-3">
              <div className="ew-button-primary flex h-14 w-14 items-center justify-center rounded-2xl shadow-lg">
                <Bot className="h-7 w-7" />
              </div>
              <h1 className="ew-title text-center text-3xl font-semibold tracking-tight">
                有什么可以帮你的？
              </h1>
              <p className="ew-subtext text-sm">在侧边栏「设置」里切换风格，体验不同工作氛围</p>
            </div>

            {/* Input */}
            <div className="w-full">
              <ChatInput
                placeholder="描述你的任务，AI 将帮你完成..."
                isRunning={false}
                onSubmit={handleSubmit}
                onStop={() => {}}
              />
            </div>

            <div className="w-full">
              <p className="ew-subtext mb-2 text-xs tracking-wide">快速开始</p>
              <div className="grid gap-2 md:grid-cols-3">
                {QUICK_START_PROMPTS.map((prompt) => (
                  <button
                    key={prompt}
                    onClick={() => handleSubmit(prompt)}
                    className="ew-list-item rounded-xl px-3 py-2 text-left text-xs leading-5"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
