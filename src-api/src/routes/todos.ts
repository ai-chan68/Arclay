import { Hono } from 'hono'
import { join } from 'path'
import { readFile } from 'fs/promises'

const app = new Hono()

interface TodoItem {
  id: string
  content: string
  status: 'pending' | 'in_progress' | 'completed' | 'failed'
  reason?: string
}

interface TodosData {
  todos: TodoItem[]
  updatedAt: string
}

// Get todos for a task
app.get('/:taskId/todos', async (c) => {
  try {
    const taskId = c.req.param('taskId')
    const workDir = c.req.query('workDir') || process.cwd()

    const todosPath = join(workDir, 'sessions', taskId, '.easywork', 'todos.json')

    try {
      const content = await readFile(todosPath, 'utf-8')
      const data: TodosData = JSON.parse(content)
      return c.json(data)
    } catch (err) {
      // File doesn't exist yet
      return c.json({ todos: [], updatedAt: null })
    }
  } catch (error) {
    console.error('[Todos] Get failed:', error)
    return c.json({ error: 'Failed to get todos' }, 500)
  }
})

export default app
