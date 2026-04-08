import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import type { UpdateWorkspaceInput, Workspace } from '@shared-types'
import {
  createWorkspace as dbCreateWorkspace,
  deleteWorkspace as dbDeleteWorkspace,
  listWorkspaces as dbListWorkspaces,
  updateWorkspace as dbUpdateWorkspace,
} from '../db'
import { api, apiFetchRaw } from '../api'

const DEFAULT_WORKSPACE_ID = 'ws_default'
const DEFAULT_WORKSPACE_NAME = '默认工作区'
const STORAGE_KEY = 'easywork.currentWorkspaceId'

interface RuntimeSettings {
  workDir?: string
}

interface CreateWorkspaceOptions {
  defaultWorkDir?: string | null
  switchToNewWorkspace?: boolean
}

interface WorkspaceContextValue {
  isReady: boolean
  workspaces: Workspace[]
  currentWorkspaceId: string | null
  currentWorkspace: Workspace | null
  switchWorkspace: (workspaceId: string) => void
  createWorkspace: (name: string, options?: CreateWorkspaceOptions) => Promise<Workspace>
  updateCurrentWorkspace: (data: UpdateWorkspaceInput) => Promise<Workspace | null>
  deleteCurrentWorkspace: () => Promise<Workspace | null>
  refresh: () => Promise<void>
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null)

function readStoredWorkspaceId(): string | null {
  if (typeof window === 'undefined') return null
  return window.localStorage.getItem(STORAGE_KEY)
}

function persistWorkspaceId(workspaceId: string): void {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(STORAGE_KEY, workspaceId)
}

function generateWorkspaceId(): string {
  return `ws_${Date.now().toString(36)}`
}

interface ScheduledTaskSummary {
  id: string
}

interface PaginatedResult<T> {
  items: T[]
}

async function moveScheduledTasksToWorkspace(
  fromWorkspaceId: string,
  toWorkspaceId: string
): Promise<void> {
  const query = new URLSearchParams({
    page: '1',
    pageSize: '500',
    workspaceId: fromWorkspaceId,
  })
  const result = await api.get<PaginatedResult<ScheduledTaskSummary>>(`/api/scheduled-tasks?${query.toString()}`)

  await Promise.all(
    result.items.map(async (task) => {
      const response = await apiFetchRaw(`/api/scheduled-tasks/${task.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId: toWorkspaceId }),
      })

      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Failed to move scheduled task' }))
        throw new Error(error.error || `HTTP ${response.status}`)
      }
    })
  )
}

async function getSystemDefaultWorkDir(): Promise<string | null> {
  try {
    const result = await api.get<RuntimeSettings>('/api/settings/runtime')
    const workDir = result.workDir?.trim()
    return workDir ? workDir : null
  } catch (error) {
    console.warn('[Workspace] Failed to load runtime workDir:', error)
    return null
  }
}

async function ensureWorkspaceList(): Promise<Workspace[]> {
  const systemDefaultWorkDir = await getSystemDefaultWorkDir()
  const workspaces = await dbListWorkspaces()
  if (workspaces.length > 0) {
    const defaultWorkspace = workspaces.find((workspace) => workspace.id === DEFAULT_WORKSPACE_ID) ?? null
    if (defaultWorkspace && !defaultWorkspace.default_work_dir && systemDefaultWorkDir) {
      const updatedWorkspace = await dbUpdateWorkspace(DEFAULT_WORKSPACE_ID, {
        default_work_dir: systemDefaultWorkDir,
      })
      if (updatedWorkspace) {
        return workspaces.map((workspace) => (
          workspace.id === updatedWorkspace.id ? updatedWorkspace : workspace
        ))
      }
    }
    return workspaces
  }

  const defaultWorkspace = await dbCreateWorkspace({
    id: DEFAULT_WORKSPACE_ID,
    name: DEFAULT_WORKSPACE_NAME,
    default_work_dir: systemDefaultWorkDir,
  })
  return [defaultWorkspace]
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [isReady, setIsReady] = useState(false)
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [currentWorkspaceId, setCurrentWorkspaceId] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    const nextWorkspaces = await ensureWorkspaceList()
    setWorkspaces(nextWorkspaces)

    const storedWorkspaceId = readStoredWorkspaceId()
    const preferredWorkspace = nextWorkspaces.find((workspace) => workspace.id === storedWorkspaceId)
      ?? nextWorkspaces[0]
      ?? null

    if (preferredWorkspace) {
      setCurrentWorkspaceId(preferredWorkspace.id)
      persistWorkspaceId(preferredWorkspace.id)
    } else {
      setCurrentWorkspaceId(null)
    }
    setIsReady(true)
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const switchWorkspace = useCallback((workspaceId: string) => {
    setCurrentWorkspaceId(workspaceId)
    persistWorkspaceId(workspaceId)
  }, [])

  const createWorkspace = useCallback(async (
    name: string,
    options?: CreateWorkspaceOptions
  ): Promise<Workspace> => {
    const workspace = await dbCreateWorkspace({
      id: generateWorkspaceId(),
      name: name.trim(),
      default_work_dir: options?.defaultWorkDir ?? null,
    })

    setWorkspaces((prev) => [...prev, workspace])
    if (options?.switchToNewWorkspace !== false) {
      setCurrentWorkspaceId(workspace.id)
      persistWorkspaceId(workspace.id)
    }
    return workspace
  }, [])

  const updateCurrentWorkspace = useCallback(async (
    data: UpdateWorkspaceInput
  ): Promise<Workspace | null> => {
    if (!currentWorkspaceId) return null
    const updated = await dbUpdateWorkspace(currentWorkspaceId, data)
    if (!updated) return null

    setWorkspaces((prev) => prev.map((workspace) => (
      workspace.id === updated.id ? updated : workspace
    )))
    return updated
  }, [currentWorkspaceId])

  const deleteCurrentWorkspace = useCallback(async (): Promise<Workspace | null> => {
    if (!currentWorkspaceId) return null

    const fallbackWorkspace = workspaces.find((workspace) => workspace.id !== currentWorkspaceId) ?? null
    if (!fallbackWorkspace) {
      throw new Error('至少保留一个工作区')
    }

    await moveScheduledTasksToWorkspace(currentWorkspaceId, fallbackWorkspace.id)
    const deleted = await dbDeleteWorkspace(currentWorkspaceId, fallbackWorkspace.id)
    if (!deleted) {
      throw new Error('删除工作区失败')
    }

    setWorkspaces((prev) => prev.filter((workspace) => workspace.id !== currentWorkspaceId))
    setCurrentWorkspaceId(fallbackWorkspace.id)
    persistWorkspaceId(fallbackWorkspace.id)
    return fallbackWorkspace
  }, [currentWorkspaceId, workspaces])

  const currentWorkspace = useMemo(() => {
    if (!currentWorkspaceId) return null
    return workspaces.find((workspace) => workspace.id === currentWorkspaceId) ?? null
  }, [currentWorkspaceId, workspaces])

  const value = useMemo<WorkspaceContextValue>(() => ({
    isReady,
    workspaces,
    currentWorkspaceId,
    currentWorkspace,
    switchWorkspace,
    createWorkspace,
    updateCurrentWorkspace,
    deleteCurrentWorkspace,
    refresh,
  }), [
    isReady,
    workspaces,
    currentWorkspaceId,
    currentWorkspace,
    switchWorkspace,
    createWorkspace,
    updateCurrentWorkspace,
    deleteCurrentWorkspace,
    refresh,
  ])

  return (
    <WorkspaceContext.Provider value={value}>
      {children}
    </WorkspaceContext.Provider>
  )
}

export function useWorkspace(): WorkspaceContextValue {
  const context = useContext(WorkspaceContext)
  if (!context) {
    throw new Error('useWorkspace must be used within a WorkspaceProvider')
  }
  return context
}
