/**
 * Right Sidebar - 文件预览面板
 */

import { useState, useEffect, useMemo } from 'react'
import { cn } from '@/shared/lib/utils'
import {
  FileText,
  Code,
  Image,
  File,
  ChevronDown,
  Radio,
  Maximize2,
  X,
  ExternalLink,
  FolderOpen,
  Copy,
  Check,
  Download,
} from 'lucide-react'
import type { AgentMessage } from '@shared-types'
import { ArtifactPreview } from '../artifacts/ArtifactPreview'
import { VitePreview } from '../task/VitePreview'
import { useVitePreview } from '../../shared/hooks/useVitePreview'
import type { Artifact } from '../../shared/types/artifacts'
import { apiFetchRaw } from '../../shared/api'
import { copyToClipboard } from '../../shared/services/clipboard-service'
import {
  extractFilesFromMessages,
  pickPrimaryArtifactForPreview,
  shouldPromotePreviewSelection,
  sortArtifactsForPreview,
} from '../../shared/lib/file-utils'

interface RightSidebarProps {
  messages: AgentMessage[]
  isRunning: boolean
  artifacts: Artifact[]
  selectedArtifact: Artifact | null
  onSelectArtifact: (artifact: Artifact) => void
  workingDir?: string
  isVisible: boolean
  taskId?: string
  onClose?: () => void
}

function isHttpUrl(value?: string): boolean {
  return !!value && /^https?:\/\//i.test(value)
}

function isLocalPreviewUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return ['localhost', '127.0.0.1', '0.0.0.0', '::1'].includes(url.hostname)
  } catch {
    return false
  }
}

function normalizeUrlToken(raw: string): string {
  return raw.replace(/[),.;!?]+$/g, '')
}

function getUrlArtifactName(urlText: string): string {
  try {
    const url = new URL(urlText)
    const path = url.pathname && url.pathname !== '/' ? url.pathname : ''
    return `${url.host}${path}`
  } catch {
    return urlText
  }
}

export function RightSidebar({
  messages,
  isRunning,
  artifacts,
  selectedArtifact,
  onSelectArtifact,
  workingDir,
  isVisible,
  taskId,
  onClose,
}: RightSidebarProps) {
  const [previewMode, setPreviewMode] = useState<'static' | 'live'>('static')
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [showFileList, setShowFileList] = useState(false)
  const [pathCopied, setPathCopied] = useState(false)
  const [isExportingZip, setIsExportingZip] = useState(false)
  const [exportNotice, setExportNotice] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
  const vitePreview = useVitePreview({
    taskId: taskId || '',
    workDir: workingDir || '',
    pollInterval: 2000
  })

  // Load saved preview mode when taskId changes
  // Note: Always default to 'static' preview, user must explicitly trigger live preview
  useEffect(() => {
    // Always reset to static preview on task change
    // Live preview requires explicit user action to start
    setPreviewMode('static')
    setIsFullscreen(false)
    setShowFileList(false)
    setExportNotice(null)
    if (vitePreview.state.status === 'running') {
      vitePreview.stop()
    }
  }, [taskId])

  useEffect(() => {
    if (!exportNotice) return
    const timeoutMs = exportNotice.type === 'success' ? 3000 : 6000
    const timer = setTimeout(() => {
      setExportNotice(null)
    }, timeoutMs)
    return () => clearTimeout(timer)
  }, [exportNotice])

  // Extract artifacts from messages
  const extractedArtifacts = useMemo(
    () => extractFilesFromMessages(messages),
    [messages]
  )

  const localUrlArtifacts = useMemo(() => {
    const urlRegex = /https?:\/\/[^\s"'`<>]+/g
    const seen = new Set<string>()
    const result: Artifact[] = []

    for (const message of messages) {
      const chunks = [message.content, message.toolOutput, message.errorMessage]
      for (const chunk of chunks) {
        if (!chunk) continue
        const matches = chunk.match(urlRegex) || []
        for (const token of matches) {
          const normalized = normalizeUrlToken(token)
          if (!isLocalPreviewUrl(normalized)) continue
          if (seen.has(normalized)) continue
          seen.add(normalized)
          result.push({
            id: `preview-url-${normalized}`,
            name: getUrlArtifactName(normalized),
            type: 'html',
            path: normalized,
          })
        }
      }
    }

    return result
  }, [messages])

  // Deduplicate and sort artifacts by preview priority (final deliverables first)
  const allArtifacts = useMemo(() => {
    const seenPaths = new Set<string>()
    const result: Artifact[] = []

    // Add artifacts from props first (they have higher priority)
    for (const artifact of artifacts) {
      if (artifact.path && !seenPaths.has(artifact.path)) {
        seenPaths.add(artifact.path)
        result.push(artifact)
      }
    }

    // Add extracted artifacts (skip duplicates)
    for (const artifact of extractedArtifacts) {
      if (artifact.path && !seenPaths.has(artifact.path)) {
        seenPaths.add(artifact.path)
        result.push(artifact)
      }
    }

    // Add local preview URLs discovered in messages
    for (const artifact of localUrlArtifacts) {
      if (artifact.path && !seenPaths.has(artifact.path)) {
        seenPaths.add(artifact.path)
        result.push(artifact)
      }
    }

    return sortArtifactsForPreview(result)
  }, [artifacts, extractedArtifacts, localUrlArtifacts])

  const exportablePaths = useMemo(() => {
    const uniquePaths = new Set<string>()
    for (const artifact of allArtifacts) {
      if (artifact.path) {
        uniquePaths.add(artifact.path)
      }
    }
    return Array.from(uniquePaths)
  }, [allArtifacts])

  // Auto-select artifact with shared preview priority strategy
  // Note: taskId change handling is done in parent component (TaskDetail.tsx)
  useEffect(() => {
    if (isRunning) {
      return
    }

    if (allArtifacts.length > 0) {
      const preferredArtifact = pickPrimaryArtifactForPreview(allArtifacts)
      const selectedStillExists = !!selectedArtifact &&
        allArtifacts.some(a => a.path === selectedArtifact.path)

      // If selection is missing or stale, select the first (highest priority)
      if ((!selectedArtifact || !selectedStillExists) && preferredArtifact) {
        onSelectArtifact(preferredArtifact)
      } else {
        if (
          selectedArtifact &&
          preferredArtifact &&
          selectedArtifact.path !== preferredArtifact.path &&
          shouldPromotePreviewSelection(selectedArtifact, preferredArtifact)
        ) {
          onSelectArtifact(preferredArtifact)
        }
      }
    }
  }, [allArtifacts, selectedArtifact, onSelectArtifact, isRunning])

  // Check if current artifact can use live preview
  const selectedArtifactIsUrl = isHttpUrl(selectedArtifact?.path)
  const canUseLivePreview = selectedArtifact?.type === 'html' && workingDir && !selectedArtifactIsUrl

  // Handle preview mode change
  // Live preview only starts when user explicitly clicks the live button
  const handlePreviewModeChange = async (mode: 'static' | 'live') => {
    setPreviewMode(mode)
    if (mode === 'live' && (vitePreview.state.status === 'idle' || vitePreview.state.status === 'error')) {
      vitePreview.start()
    } else if (mode === 'static' && vitePreview.state.status === 'running') {
      vitePreview.stop()
    }
  }

  const getParentDir = (filePath: string): string => {
    const normalized = filePath.replace(/\\/g, '/')
    const idx = normalized.lastIndexOf('/')
    if (idx <= 0) return filePath
    return normalized.slice(0, idx)
  }

  const handleOpenPath = async (targetPath: string | undefined) => {
    if (!targetPath) return
    if (isHttpUrl(targetPath)) {
      window.open(targetPath, '_blank', 'noopener,noreferrer')
      return
    }
    try {
      await apiFetchRaw('/api/files/open', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: targetPath }),
      })
    } catch (error) {
      console.error('[RightSidebar] Failed to open path:', error)
    }
  }

  const handleOpenFile = async () => {
    await handleOpenPath(selectedArtifact?.path)
  }

  const handleOpenFolder = async () => {
    if (!selectedArtifact?.path) return
    await handleOpenPath(getParentDir(selectedArtifact.path))
  }

  const handleCopyPath = async () => {
    if (!selectedArtifact?.path) return
    try {
      await copyToClipboard(selectedArtifact.path)
      setPathCopied(true)
      setTimeout(() => setPathCopied(false), 1500)
    } catch (error) {
      console.error('[RightSidebar] Failed to copy path:', error)
    }
  }

  const parseDownloadFilename = (contentDisposition: string | null, fallback: string): string => {
    if (!contentDisposition) return fallback
    const utf8Match = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i)
    if (utf8Match?.[1]) {
      try {
        return decodeURIComponent(utf8Match[1]).replace(/[/\\]/g, '-')
      } catch {
        return utf8Match[1].replace(/[/\\]/g, '-')
      }
    }
    const quotedMatch = contentDisposition.match(/filename=\"([^\"]+)\"/i)
    if (quotedMatch?.[1]) {
      return quotedMatch[1].replace(/[/\\]/g, '-')
    }
    const plainMatch = contentDisposition.match(/filename=([^;]+)/i)
    if (plainMatch?.[1]) {
      return plainMatch[1].trim().replace(/[/\\]/g, '-')
    }
    return fallback
  }

  const handleExportAllZip = async () => {
    if (isExportingZip || exportablePaths.length === 0) return
    setIsExportingZip(true)
    setExportNotice(null)
    try {
      const baseName = taskId ? `task-${taskId}-artifacts` : 'artifacts'
      const response = await apiFetchRaw('/api/files/export-zip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          paths: exportablePaths,
          name: baseName,
        }),
      })

      if (!response.ok) {
        const errData = await response.json().catch(() => null)
        const message = errData && typeof errData.error === 'string'
          ? errData.error
          : `HTTP ${response.status}`
        throw new Error(message)
      }

      const blob = await response.blob()
      const fileName = parseDownloadFilename(
        response.headers.get('content-disposition'),
        `${baseName}.zip`
      )

      const downloadUrl = window.URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = downloadUrl
      link.download = fileName
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.URL.revokeObjectURL(downloadUrl)
      setExportNotice({ type: 'success', message: `已开始下载 ${fileName}` })
    } catch (error) {
      console.error('[RightSidebar] Failed to export zip:', error)
      setExportNotice({
        type: 'error',
        message: error instanceof Error ? `导出失败：${error.message}` : '导出失败，请稍后重试',
      })
    } finally {
      setIsExportingZip(false)
    }
  }

  // 获取文件图标
  const getFileIcon = (type: Artifact['type']) => {
    switch (type) {
      case 'code':
        return <Code className="size-4 text-sky-500" />
      case 'document':
        return <FileText className="size-4 text-orange-500" />
      case 'image':
        return <Image className="size-4 text-emerald-500" />
      case 'html':
        return <FileText className="size-4 text-violet-500" />
      default:
        return <File className="size-4 text-muted-foreground" />
    }
  }

  const liveStatusMeta = useMemo(() => {
    switch (vitePreview.state.status) {
      case 'running':
        return { label: '实时渲染中', tone: 'text-emerald-500', dot: 'bg-emerald-500' }
      case 'starting':
        return { label: '正在启动预览服务', tone: 'text-amber-500', dot: 'bg-amber-500 animate-pulse' }
      case 'stopping':
        return { label: '正在停止预览服务', tone: 'text-orange-500', dot: 'bg-orange-500' }
      case 'error':
        return { label: '预览服务异常', tone: 'text-red-500', dot: 'bg-red-500' }
      default:
        return { label: '实时预览未启动', tone: 'text-muted-foreground', dot: 'bg-muted-foreground/60' }
    }
  }, [vitePreview.state.status])

  useEffect(() => {
    if (previewMode !== 'live') return
    if (canUseLivePreview) return
    setPreviewMode('static')
    if (vitePreview.state.status === 'running') {
      vitePreview.stop()
    }
  }, [canUseLivePreview, previewMode, vitePreview.state.status])

  const renderPreviewContent = (embeddedLive: boolean) => {
    if (!selectedArtifact) {
      return (
        <div className="flex h-full flex-col items-center justify-center text-muted-foreground">
          <File className="mb-2 size-8 opacity-50" />
          <p className="text-sm">选择文件预览</p>
          {allArtifacts.length > 0 && (
            <p className="mt-1 text-xs text-muted-foreground/70">
              {allArtifacts.length} 个文件可用
            </p>
          )}
        </div>
      )
    }

    if (previewMode === 'live' && canUseLivePreview) {
      return (
        <VitePreview
          previewUrl={vitePreview.state.url}
          status={vitePreview.state.status}
          error={vitePreview.state.error}
          onStart={vitePreview.start}
          onStop={vitePreview.stop}
          onRefresh={vitePreview.refresh}
          embedded={embeddedLive}
        />
      )
    }

    return (
      <ArtifactPreview
        artifact={selectedArtifact}
        allArtifacts={allArtifacts}
        hideHeader
      />
    )
  }

  if (!isVisible) return null

  // 全屏预览模式
  if (isFullscreen && selectedArtifact) {
    return (
      <div className="fixed inset-0 z-50 bg-black/55 p-3 backdrop-blur-sm">
        <div className="ew-main-panel flex h-full flex-col rounded-2xl p-3">
          <div className="ew-card mb-2 flex items-center justify-between rounded-xl px-3 py-2">
            <div className="flex min-w-0 items-center gap-2">
              {getFileIcon(selectedArtifact.type)}
              <h2 className="truncate text-sm font-semibold">{selectedArtifact.name}</h2>
            </div>
            <div className="flex items-center gap-2">
              {canUseLivePreview && (
                <div className="flex rounded-lg bg-[color-mix(in_oklab,var(--ui-accent-soft)_72%,transparent)] p-0.5">
                  <button
                    onClick={() => handlePreviewModeChange('static')}
                    className={cn(
                      'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                      previewMode === 'static'
                        ? 'bg-[color-mix(in_oklab,var(--ui-panel)_80%,#fff_20%)] text-[var(--ui-text)]'
                        : 'text-[var(--ui-subtext)] hover:text-[var(--ui-text)]'
                    )}
                  >
                    静态
                  </button>
                  <button
                    onClick={() => handlePreviewModeChange('live')}
                    className={cn(
                      'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                      previewMode === 'live'
                        ? 'bg-[color-mix(in_oklab,var(--ui-panel)_80%,#fff_20%)] text-[var(--ui-text)]'
                        : 'text-[var(--ui-subtext)] hover:text-[var(--ui-text)]'
                    )}
                  >
                    实时
                  </button>
                </div>
              )}
              <button
                onClick={() => setIsFullscreen(false)}
                className="ew-icon-btn flex size-7 items-center justify-center rounded-md"
              >
                <X className="size-4" />
              </button>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-hidden rounded-xl bg-[color-mix(in_oklab,var(--ui-panel-2)_78%,#fff_22%)] p-2">
            <div className="h-full overflow-hidden rounded-lg bg-[color-mix(in_oklab,var(--ui-panel)_84%,#fff_16%)]">
              {renderPreviewContent(false)}
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="ew-sidebar flex h-full w-full min-w-0 flex-col gap-3 px-3 py-3">
      {/* Header - 文件选择器 */}
      <div className="relative ew-card shrink-0 rounded-2xl p-2">
        <button
          onClick={() => allArtifacts.length > 1 && setShowFileList(!showFileList)}
          className={cn(
            'flex w-full items-center justify-between rounded-xl px-2.5 py-2',
            allArtifacts.length > 1 && 'cursor-pointer'
          )}
        >
          <div className="flex items-center gap-2">
            {selectedArtifact ? getFileIcon(selectedArtifact.type) : <File className="size-4 text-muted-foreground" />}
            <span className="truncate text-sm font-medium">
              {selectedArtifact?.name || '预览'}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {allArtifacts.length > 1 && (
              <ChevronDown
                className={cn(
                  'size-4 text-muted-foreground transition-transform',
                  showFileList && 'rotate-180'
                )}
              />
            )}
            {onClose && (
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  onClose()
                }}
                className="ew-icon-btn flex h-6 w-6 items-center justify-center rounded"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </button>

        {/* 文件下拉列表 */}
        {showFileList && allArtifacts.length > 1 && (
          <div className="ew-card absolute left-1 right-1 top-[calc(100%+8px)] z-10 max-h-64 overflow-auto rounded-2xl p-1.5 shadow-lg">
            {allArtifacts.map((artifact) => (
              <button
                key={artifact.id}
                className={cn(
                  'ew-list-item flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm transition-colors',
                  selectedArtifact?.id === artifact.id
                    ? 'active'
                    : ''
                )}
                onClick={() => {
                  onSelectArtifact(artifact)
                  setShowFileList(false)
                }}
              >
                {getFileIcon(artifact.type)}
                <span className="truncate flex-1">{artifact.name}</span>
                {artifact.fileSize && (
                  <span className="text-xs text-muted-foreground">
                    {Math.round(artifact.fileSize / 1024)}KB
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 预览控制栏 */}
      {selectedArtifact && (
        <div className="ew-card -mt-1 flex shrink-0 items-center justify-between rounded-2xl px-3 py-2">
          <div className="flex items-center gap-1.5">
            <span className={cn('size-1.5 rounded-full', liveStatusMeta.dot)} />
            <span className={cn('text-xs font-medium', previewMode === 'live' ? liveStatusMeta.tone : 'text-muted-foreground')}>
              {previewMode === 'live' ? liveStatusMeta.label : '静态预览'}
            </span>
          </div>
          <div className="flex items-center gap-1">
            {selectedArtifact.path && (
              <>
                <button
                  onClick={handleOpenFile}
                  className="ew-icon-btn flex h-6 w-6 items-center justify-center rounded"
                  title={selectedArtifactIsUrl ? '打开链接' : '打开文件'}
                >
                  <ExternalLink className="size-3" />
                </button>
                {!selectedArtifactIsUrl && (
                  <button
                    onClick={handleOpenFolder}
                    className="ew-icon-btn flex h-6 w-6 items-center justify-center rounded"
                    title="打开所在文件夹"
                  >
                    <FolderOpen className="size-3" />
                  </button>
                )}
                <button
                  onClick={handleCopyPath}
                  className="ew-icon-btn flex h-6 w-6 items-center justify-center rounded"
                  title={pathCopied ? '已复制路径' : '复制路径'}
                >
                  {pathCopied ? <Check className="size-3" /> : <Copy className="size-3" />}
                </button>
              </>
            )}
            {canUseLivePreview && (
              <div className="flex rounded-lg bg-[color-mix(in_oklab,var(--ui-accent-soft)_72%,transparent)] p-0.5">
                <button
                  onClick={() => handlePreviewModeChange('static')}
                  className={cn(
                    'rounded-md px-2 py-0.5 text-xs font-medium transition-colors',
                    previewMode === 'static'
                      ? 'bg-[color-mix(in_oklab,var(--ui-panel)_80%,#fff_20%)] text-[var(--ui-text)]'
                      : 'text-[var(--ui-subtext)] hover:text-[var(--ui-text)]'
                  )}
                >
                  静态
                </button>
                <button
                  onClick={() => handlePreviewModeChange('live')}
                  className={cn(
                    'rounded-md px-2 py-0.5 text-xs font-medium transition-colors',
                    previewMode === 'live'
                      ? 'bg-[color-mix(in_oklab,var(--ui-panel)_80%,#fff_20%)] text-[var(--ui-text)]'
                      : 'text-[var(--ui-subtext)] hover:text-[var(--ui-text)]'
                  )}
                >
                  实时
                </button>
              </div>
            )}
            <button
              onClick={() => setIsFullscreen(true)}
              className="ew-icon-btn flex h-6 w-6 items-center justify-center rounded"
              title="全屏预览"
            >
              <Maximize2 className="size-3" />
            </button>
          </div>
        </div>
      )}

      {/* 预览内容区域 */}
      <div className="ew-card min-h-0 flex-1 overflow-hidden rounded-[1.25rem] p-2.5">
        <div className="h-full overflow-hidden rounded-xl bg-[color-mix(in_oklab,var(--ui-panel)_88%,#fff_12%)]">
          {renderPreviewContent(true)}
        </div>
      </div>

      {/* 底部状态条 */}
      {selectedArtifact && (
        <div className="flex shrink-0 items-center justify-between rounded-xl border border-[color:color-mix(in_oklab,var(--ui-border)_58%,transparent)] bg-[color:color-mix(in_oklab,var(--ui-panel)_66%,transparent)] px-3 py-1.5 text-xs">
          <div className="flex items-center gap-1.5 text-[var(--ui-subtext)]">
            <Radio className="size-3.5" />
            <span>{selectedArtifact.type.toUpperCase()} 预览</span>
          </div>
          <div className="flex items-center gap-2">
            {exportablePaths.length > 0 && (
              <button
                onClick={handleExportAllZip}
                disabled={isExportingZip}
                className="inline-flex items-center gap-1 rounded-md border border-[color-mix(in_oklab,var(--ui-border)_70%,transparent)] px-2 py-1 text-[11px] text-[var(--ui-subtext)] transition-colors hover:text-[var(--ui-text)] disabled:cursor-not-allowed disabled:opacity-50"
                title="导出当前任务全部文件为 zip"
              >
                <Download className="size-3" />
                <span>{isExportingZip ? '导出中...' : '导出全部(zip)'}</span>
              </button>
            )}
            <span className="text-[var(--ui-subtext)]">
              {previewMode === 'live' && canUseLivePreview ? '实时模式' : '静态模式'}
            </span>
          </div>
        </div>
      )}

      {previewMode === 'live' && vitePreview.state.error && (
        <div className="ew-card ew-danger-soft shrink-0 rounded-xl px-3 py-2 text-xs text-red-500">
          {vitePreview.state.error}
        </div>
      )}

      {exportNotice && (
        <div
          className={cn(
            'ew-card shrink-0 rounded-xl px-3 py-2 text-xs',
            exportNotice.type === 'success'
              ? 'border-emerald-200/60 bg-emerald-50/70 text-emerald-700'
              : 'ew-danger-soft text-red-500'
          )}
        >
          {exportNotice.message}
        </div>
      )}
    </div>
  )
}
