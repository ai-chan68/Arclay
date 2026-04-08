/**
 * Knowledge Notes Manager - 知识笔记管理组件
 */

import { useState, useEffect } from 'react'
import { Plus, Trash2, Edit2, BookOpen, Loader2, Check, X } from 'lucide-react'
import { cn } from '@/shared/lib/utils'

interface KnowledgeNote {
  id: string
  type: 'context' | 'instruction' | 'reference'
  title: string
  content: string
  enabled: boolean
  scope: 'global'
  createdAt: string
  updatedAt: string
}

interface KnowledgeNotesManagerProps {
  scope: 'global'
}

export function KnowledgeNotesManager({ scope }: KnowledgeNotesManagerProps) {
  const [notes, setNotes] = useState<KnowledgeNote[]>([])
  const [loading, setLoading] = useState(false)
  const [isFormOpen, setIsFormOpen] = useState(false)
  const [editingNote, setEditingNote] = useState<KnowledgeNote | null>(null)

  // Form state
  const [formType, setFormType] = useState<'context' | 'instruction' | 'reference'>('context')
  const [formTitle, setFormTitle] = useState('')
  const [formContent, setFormContent] = useState('')
  const [formEnabled, setFormEnabled] = useState(true)

  useEffect(() => {
    loadNotes()
  }, [scope])

  const loadNotes = async () => {
    setLoading(true)
    try {
      const response = await fetch(`/api/knowledge-notes?scope=${scope}`)
      if (!response.ok) throw new Error('Failed to load notes')
      const data = await response.json()
      setNotes(data.notes || [])
    } catch (err) {
      console.error('Failed to load knowledge notes:', err)
    } finally {
      setLoading(false)
    }
  }

  const handleCreate = async () => {
    try {
      const response = await fetch('/api/knowledge-notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: formType,
          title: formTitle,
          content: formContent,
          enabled: formEnabled,
          scope,
        }),
      })
      if (!response.ok) throw new Error('Failed to create note')
      await loadNotes()
      resetForm()
    } catch (err) {
      console.error('Failed to create note:', err)
    }
  }

  const handleUpdate = async () => {
    if (!editingNote) return
    try {
      const response = await fetch(`/api/knowledge-notes/${editingNote.id}?scope=${scope}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: formType,
          title: formTitle,
          content: formContent,
          enabled: formEnabled,
        }),
      })
      if (!response.ok) throw new Error('Failed to update note')
      await loadNotes()
      resetForm()
    } catch (err) {
      console.error('Failed to update note:', err)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('确定要删除这条知识笔记吗？')) return
    try {
      const response = await fetch(`/api/knowledge-notes/${id}?scope=${scope}`, {
        method: 'DELETE',
      })
      if (!response.ok) throw new Error('Failed to delete note')
      await loadNotes()
    } catch (err) {
      console.error('Failed to delete note:', err)
    }
  }

  const handleToggleEnabled = async (note: KnowledgeNote) => {
    try {
      const response = await fetch(`/api/knowledge-notes/${note.id}?scope=${scope}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !note.enabled }),
      })
      if (!response.ok) throw new Error('Failed to toggle note')
      await loadNotes()
    } catch (err) {
      console.error('Failed to toggle note:', err)
    }
  }

  const openEditForm = (note: KnowledgeNote) => {
    setEditingNote(note)
    setFormType(note.type)
    setFormTitle(note.title)
    setFormContent(note.content)
    setFormEnabled(note.enabled)
    setIsFormOpen(true)
  }

  const resetForm = () => {
    setIsFormOpen(false)
    setEditingNote(null)
    setFormType('context')
    setFormTitle('')
    setFormContent('')
    setFormEnabled(true)
  }

  const getTypeLabel = (type: string) => {
    const map: Record<string, string> = {
      context: '上下文',
      instruction: '指令',
      reference: '参考',
    }
    return map[type] || type
  }

  const getTypeColor = (type: string) => {
    const map: Record<string, string> = {
      context: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
      instruction: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
      reference: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
    }
    return map[type] || ''
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <BookOpen className="size-4" />
          <h3 className="text-sm font-medium">知识笔记（全局）</h3>
        </div>
        <button
          onClick={() => setIsFormOpen(true)}
          className="flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:bg-primary/90"
        >
          <Plus className="size-4" />
          添加 Note
        </button>
      </div>

      {loading && (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {!loading && notes.length === 0 && (
        <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
          <BookOpen className="mb-2 size-8 opacity-50" />
          <p className="text-sm">暂无知识笔记</p>
        </div>
      )}

      {!loading && notes.length > 0 && (
        <div className="space-y-2">
          {notes.map((note) => (
            <div
              key={note.id}
              className={cn(
                'rounded-lg border border-border p-3',
                !note.enabled && 'opacity-50'
              )}
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className={cn('rounded px-2 py-0.5 text-xs font-medium', getTypeColor(note.type))}>
                      {getTypeLabel(note.type)}
                    </span>
                    <h4 className="font-medium">{note.title}</h4>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground line-clamp-2">
                    {note.content}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => handleToggleEnabled(note)}
                    className={cn(
                      'rounded p-1.5 text-sm',
                      note.enabled ? 'text-emerald-600 hover:bg-emerald-50' : 'text-muted-foreground hover:bg-muted'
                    )}
                    title={note.enabled ? '禁用' : '启用'}
                  >
                    {note.enabled ? <Check className="size-4" /> : <X className="size-4" />}
                  </button>
                  <button
                    onClick={() => openEditForm(note)}
                    className="rounded p-1.5 hover:bg-muted"
                  >
                    <Edit2 className="size-4" />
                  </button>
                  <button
                    onClick={() => handleDelete(note.id)}
                    className="rounded p-1.5 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20"
                    aria-label="删除笔记"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Form Modal */}
      {isFormOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div
            className="ew-card w-[90vw] max-w-2xl rounded-2xl p-6"
            role="dialog"
            aria-modal="true"
            aria-label={editingNote ? '编辑知识笔记' : '新建知识笔记'}
          >
            <h3 className="mb-4 text-lg font-semibold">
              {editingNote ? '编辑知识笔记' : '新建知识笔记'}
            </h3>

            <div className="space-y-4">
              <div>
                <label htmlFor="knowledge-note-type" className="mb-1.5 block text-sm font-medium">类型</label>
                <select
                  id="knowledge-note-type"
                  value={formType}
                  onChange={(e) => setFormType(e.target.value as any)}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                >
                  <option value="context">上下文 - 提供背景信息</option>
                  <option value="instruction">指令 - 行为约束</option>
                  <option value="reference">参考 - 文档链接</option>
                </select>
              </div>

              <div>
                <label htmlFor="knowledge-note-title" className="mb-1.5 block text-sm font-medium">标题</label>
                <input
                  id="knowledge-note-title"
                  type="text"
                  value={formTitle}
                  onChange={(e) => setFormTitle(e.target.value)}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                  placeholder="例如：项目架构说明"
                />
              </div>

              <div>
                <label htmlFor="knowledge-note-content" className="mb-1.5 block text-sm font-medium">内容</label>
                <textarea
                  id="knowledge-note-content"
                  value={formContent}
                  onChange={(e) => setFormContent(e.target.value)}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                  rows={8}
                  placeholder="输入知识笔记内容..."
                />
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="enabled"
                  checked={formEnabled}
                  onChange={(e) => setFormEnabled(e.target.checked)}
                  className="size-4"
                />
                <label htmlFor="enabled" className="text-sm">启用</label>
              </div>
            </div>

            <div className="mt-6 flex items-center justify-end gap-2">
              <button
                onClick={resetForm}
                className="rounded-lg px-4 py-2 text-sm hover:bg-muted"
              >
                取消
              </button>
              <button
                onClick={editingNote ? handleUpdate : handleCreate}
                disabled={!formTitle || !formContent}
                className="rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {editingNote ? '保存' : '创建'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
