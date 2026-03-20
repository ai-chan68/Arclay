import { Hono } from 'hono'
import { z } from 'zod'
import { getWorkDir } from '../config'
import { explainCronExpression, getUpcomingRuns, suggestCronExpressionsFromText, validateCronExpression } from '../services/cron-utils'
import { buildExecutionPrompt } from '../services/plan-execution'
import { scheduledTaskScheduler } from '../services/scheduled-task-scheduler'
import { scheduledTaskDefaults, scheduledTaskStore } from '../services/scheduled-task-store'
import { getAgentService } from './agent-new'
import type { TaskPlan } from '../types/agent-new'
import type { ScheduledTaskBreakerState } from '../types/scheduled-task'

const taskPlanSchema: z.ZodType<TaskPlan> = z.object({
  id: z.string().min(1),
  goal: z.string().min(1),
  steps: z.array(
    z.object({
      id: z.string().min(1),
      description: z.string().min(1),
      status: z.enum(['pending', 'in_progress', 'completed', 'failed']),
    })
  ).min(1),
  notes: z.string().optional(),
  createdAt: z.union([z.date(), z.string(), z.number()]).transform((value) => {
    if (value instanceof Date) return value
    return new Date(value)
  }),
})

const createTaskSchema = z.object({
  name: z.string().min(1).max(120),
  enabled: z.boolean().optional(),
  cronExpr: z.string().min(1),
  timezone: z.string().min(1).default(scheduledTaskDefaults.timezone),
  sourcePrompt: z.string().min(1),
  approvedPlan: taskPlanSchema,
  executionPromptSnapshot: z.string().optional(),
  workDir: z.string().optional(),
  maxConsecutiveFailures: z.number().int().min(1).max(20).optional(),
  cooldownSeconds: z.number().int().min(60).max(24 * 60 * 60).optional(),
  timeoutSeconds: z.number().int().min(30).max(24 * 60 * 60).optional(),
})

const updateTaskSchema = createTaskSchema.partial()

function parseBooleanQuery(value: string | undefined): boolean | undefined {
  if (!value) return undefined
  if (value === 'true') return true
  if (value === 'false') return false
  return undefined
}

function parseIntQuery(value: string | undefined, defaultValue: number): number {
  if (!value) return defaultValue
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return defaultValue
  return Math.floor(parsed)
}

export const scheduledTaskRoutes = new Hono()

scheduledTaskRoutes.get('/cron/preview', (c) => {
  const expr = c.req.query('expr')
  const timezone = c.req.query('timezone') || scheduledTaskDefaults.timezone
  const count = parseIntQuery(c.req.query('count'), 5)

  if (!expr) {
    return c.json({ error: 'expr is required' }, 400)
  }

  const result = validateCronExpression(expr, timezone)
  if (!result.valid) {
    return c.json({ valid: false, error: result.error }, 400)
  }

  const runs = getUpcomingRuns(expr, timezone, Math.min(count, 10)).map((date) => date.toISOString())
  return c.json({ valid: true, upcomingRuns: runs })
})

scheduledTaskRoutes.get('/cron/explain', (c) => {
  const expr = c.req.query('expr')
  const timezone = c.req.query('timezone') || scheduledTaskDefaults.timezone

  if (!expr) {
    return c.json({ error: 'expr is required' }, 400)
  }

  const validation = validateCronExpression(expr, timezone)
  if (!validation.valid) {
    return c.json({ valid: false, error: validation.error }, 400)
  }

  const description = explainCronExpression(expr, timezone)
  return c.json({
    valid: true,
    expr,
    timezone,
    description,
  })
})

const cronSuggestSchema = z.object({
  text: z.string().min(1),
  timezone: z.string().optional(),
})

scheduledTaskRoutes.post('/cron/suggest', async (c) => {
  const body = await c.req.json().catch(() => null)
  const parsed = cronSuggestSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ error: 'Invalid request body', details: parsed.error.flatten() }, 400)
  }

  const timezone = parsed.data.timezone || scheduledTaskDefaults.timezone
  const suggestions = suggestCronExpressionsFromText(parsed.data.text, timezone)

  return c.json({
    timezone,
    suggestions,
  })
})

const planSuggestSchema = z.object({
  prompt: z.string().min(1),
  workDir: z.string().optional(),
})

scheduledTaskRoutes.post('/plan/suggest', async (c) => {
  const body = await c.req.json().catch(() => null)
  const parsed = planSuggestSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ error: 'Invalid request body', details: parsed.error.flatten() }, 400)
  }

  const agentService = getAgentService()
  if (!agentService) {
    return c.json({ error: 'Agent service not initialized' }, 500)
  }

  const agent = agentService.createAgent()
  if (!agent.plan) {
    return c.json({ error: 'Current provider does not support plan generation' }, 400)
  }

  const prompt = parsed.data.prompt.trim()
  const workDir = parsed.data.workDir || getWorkDir()

  try {
    let plan: TaskPlan | null = null
    let directAnswer = ''

    for await (const message of agent.plan(prompt, {
      sessionId: `sched_plan_${Date.now()}`,
      cwd: workDir,
    })) {
      if (message.type === 'plan' && message.plan) {
        plan = message.plan as TaskPlan
        break
      }
      if (message.type === 'text' && message.role === 'assistant' && message.content) {
        directAnswer = message.content
      }
    }

    if (!plan) {
      return c.json({
        error: 'Planner did not return a structured plan',
        directAnswer: directAnswer || null,
      }, 422)
    }

    return c.json({ plan })
  } catch (error) {
    console.error('[ScheduledTaskRoutes] Failed to generate suggested plan:', error)
    return c.json({ error: error instanceof Error ? error.message : 'Failed to generate plan' }, 500)
  }
})

scheduledTaskRoutes.get('/runs/:runId', (c) => {
  const runId = c.req.param('runId')
  const run = scheduledTaskStore.getRun(runId)
  if (!run) {
    return c.json({ error: 'Run not found' }, 404)
  }
  return c.json(run)
})

scheduledTaskRoutes.get('/', (c) => {
  const breakerStateQuery = c.req.query('breakerState')
  const breakerState = breakerStateQuery && ['closed', 'open', 'half_open'].includes(breakerStateQuery)
    ? breakerStateQuery as ScheduledTaskBreakerState
    : undefined

  const query = {
    enabled: parseBooleanQuery(c.req.query('enabled')),
    breakerState,
    keyword: c.req.query('keyword'),
    page: parseIntQuery(c.req.query('page'), 1),
    pageSize: parseIntQuery(c.req.query('pageSize'), 20),
  }

  const data = scheduledTaskStore.listTasks(query)
  return c.json(data)
})

scheduledTaskRoutes.post('/', async (c) => {
  const body = await c.req.json().catch(() => null)
  const parsed = createTaskSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ error: 'Invalid request body', details: parsed.error.flatten() }, 400)
  }

  const payload = parsed.data
  const cronValidation = validateCronExpression(payload.cronExpr, payload.timezone)
  if (!cronValidation.valid) {
    return c.json({ error: cronValidation.error }, 400)
  }

  const workDir = payload.workDir || getWorkDir()
  const executionPromptSnapshot = payload.executionPromptSnapshot && payload.executionPromptSnapshot.trim() !== ''
    ? payload.executionPromptSnapshot
    : buildExecutionPrompt(payload.approvedPlan, payload.sourcePrompt, workDir)

  const task = scheduledTaskStore.createTask({
    ...payload,
    workDir,
    executionPromptSnapshot,
  })

  return c.json(task, 201)
})

scheduledTaskRoutes.get('/:id', (c) => {
  const id = c.req.param('id')
  const task = scheduledTaskStore.getTask(id)
  if (!task) {
    return c.json({ error: 'Task not found' }, 404)
  }
  return c.json(task)
})

scheduledTaskRoutes.patch('/:id', async (c) => {
  const id = c.req.param('id')
  const existing = scheduledTaskStore.getTask(id)
  if (!existing) {
    return c.json({ error: 'Task not found' }, 404)
  }

  const body = await c.req.json().catch(() => null)
  const parsed = updateTaskSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ error: 'Invalid request body', details: parsed.error.flatten() }, 400)
  }

  const payload = parsed.data
  const nextTimezone = payload.timezone ?? existing.timezone
  const nextCronExpr = payload.cronExpr ?? existing.cronExpr
  const cronValidation = validateCronExpression(nextCronExpr, nextTimezone)
  if (!cronValidation.valid) {
    return c.json({ error: cronValidation.error }, 400)
  }

  const nextSourcePrompt = payload.sourcePrompt ?? existing.sourcePrompt
  const nextPlan = payload.approvedPlan ?? existing.approvedPlan
  const workDir = payload.workDir ?? existing.workDir ?? getWorkDir()
  const regeneratedSnapshot = nextPlan
    ? buildExecutionPrompt(nextPlan, nextSourcePrompt, workDir)
    : nextSourcePrompt
  const nextSnapshot = payload.executionPromptSnapshot
    ?? (payload.approvedPlan || payload.sourcePrompt
      ? regeneratedSnapshot
      : existing.executionPromptSnapshot)

  const task = scheduledTaskStore.updateTask(id, {
    ...payload,
    workDir,
    executionPromptSnapshot: nextSnapshot,
  })

  if (!task) {
    return c.json({ error: 'Task not found' }, 404)
  }
  return c.json(task)
})

scheduledTaskRoutes.delete('/:id', (c) => {
  const id = c.req.param('id')
  const ok = scheduledTaskStore.deleteTask(id)
  if (!ok) {
    return c.json({ error: 'Task not found' }, 404)
  }
  return c.json({ success: true })
})

scheduledTaskRoutes.post('/:id/enable', (c) => {
  const id = c.req.param('id')
  const task = scheduledTaskStore.setTaskEnabled(id, true)
  if (!task) {
    return c.json({ error: 'Task not found' }, 404)
  }
  return c.json(task)
})

scheduledTaskRoutes.post('/:id/disable', (c) => {
  const id = c.req.param('id')
  const task = scheduledTaskStore.setTaskEnabled(id, false)
  if (!task) {
    return c.json({ error: 'Task not found' }, 404)
  }
  return c.json(task)
})

scheduledTaskRoutes.post('/:id/reset-breaker', (c) => {
  const id = c.req.param('id')
  const task = scheduledTaskStore.resetTaskBreaker(id)
  if (!task) {
    return c.json({ error: 'Task not found' }, 404)
  }
  return c.json(task)
})

scheduledTaskRoutes.post('/:id/run-now', (c) => {
  const id = c.req.param('id')
  const task = scheduledTaskStore.getTask(id)
  if (!task) {
    return c.json({ error: 'Task not found' }, 404)
  }

  void scheduledTaskScheduler.runNow(id).catch((error) => {
    console.error(`[ScheduledTaskRoutes] run-now failed for task ${id}:`, error)
  })

  return c.json({
    success: true,
    accepted: true,
    message: 'Manual run started',
  }, 202)
})

scheduledTaskRoutes.get('/:id/runs', (c) => {
  const id = c.req.param('id')
  const task = scheduledTaskStore.getTask(id)
  if (!task) {
    return c.json({ error: 'Task not found' }, 404)
  }

  const page = parseIntQuery(c.req.query('page'), 1)
  const pageSize = parseIntQuery(c.req.query('pageSize'), 20)
  const data = scheduledTaskStore.listRuns({ taskId: id, page, pageSize })
  return c.json(data)
})
