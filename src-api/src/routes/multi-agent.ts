/**
 * Multi-Agent API routes
 *
 * @experimental
 * @status NOT_INTEGRATED - Backend implemented, frontend integration pending
 *
 * These endpoints are functional but not connected to the frontend UI.
 * Use `/api/v2/agent/*` for production single-agent execution.
 *
 * TODO:
 * - Create useMultiAgent hook in frontend
 * - Add UI for task decomposition preview
 * - Integrate with TaskDetailPage
 */

import { Hono } from 'hono'
import { stream } from 'hono/streaming'
import { MultiAgentOrchestrator } from '../core/agent/orchestrator'
import { getProvider, getProvidersMetadata } from '../core/agent/providers'
import { getProviderConfig } from '../config'
import { getSettings, getActiveProviderConfig } from '../settings-store'
import type { MultiAgentConfig, TaskAnalysis, ProviderConfig } from '@shared-types'
import { randomUUID } from 'crypto'

// Store active orchestrators by execution ID
const activeExecutions = new Map<string, MultiAgentOrchestrator>()

export const multiAgentRoutes = new Hono()

/**
 * Get provider configuration - prefer active provider from settings store over environment variables
 */
function getEffectiveProviderConfig(): ProviderConfig {
  // First try to get active provider from settings store
  const activeProvider = getActiveProviderConfig()
  if (activeProvider && activeProvider.apiKey) {
    console.log('[Multi-Agent] Using active provider from store:', activeProvider.provider, activeProvider.model)
    return {
      provider: activeProvider.provider as ProviderConfig['provider'],
      apiKey: activeProvider.apiKey,
      model: activeProvider.model,
      baseUrl: activeProvider.baseUrl
    }
  }

  // Fallback to environment variables
  console.log('[Multi-Agent] Using config from environment variables')
  return getProviderConfig()
}

/**
 * POST /api/agent/multi/stream - Execute multi-agent task with streaming
 */
multiAgentRoutes.post('/stream', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const { prompt, config } = body as {
    prompt: string
    config?: Partial<MultiAgentConfig>
  }

  if (!prompt) {
    return c.json({ error: 'prompt is required' }, 400)
  }

  // Get provider from settings or environment
  const providerConfig = getEffectiveProviderConfig()
  console.log('[Multi-Agent] Provider config:', providerConfig.provider, 'model:', providerConfig.model)
  console.log('[Multi-Agent] API Key configured:', !!providerConfig.apiKey)
  console.log('[Multi-Agent] Available providers:', Array.from(getProvidersMetadata().keys()))
  const provider = getProvider(providerConfig.provider)

  if (!provider) {
    console.error('[Multi-Agent] Provider not found:', providerConfig.provider)
    return c.json({ error: `Provider not found: ${providerConfig.provider}` }, 500)
  }

  if (!providerConfig.apiKey) {
    console.error('[Multi-Agent] API key not configured')
    return c.json({ error: 'API key not configured. Please configure in Settings.' }, 400)
  }

  // Create orchestrator with config and provider
  const orchestrator = new MultiAgentOrchestrator(config, {
    provider,
    providerConfig
  })
  const executionId = randomUUID()
  activeExecutions.set(executionId, orchestrator)

  // Set SSE headers
  c.header('Content-Type', 'text/event-stream')
  c.header('Cache-Control', 'no-cache')
  c.header('Connection', 'keep-alive')

  return stream(c, async (s) => {
    try {
      for await (const message of orchestrator.execute(prompt)) {
        // Send as SSE event
        s.write(`event: ${message.type}\n`)
        s.write(`data: ${JSON.stringify(message)}\n\n`)
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      s.write(`event: error\n`)
      s.write(`data: ${JSON.stringify({ error: errorMessage })}\n\n`)
    } finally {
      activeExecutions.delete(executionId)
    }
  })
})

/**
 * POST /api/agent/multi/preview - Preview decomposition without execution
 */
multiAgentRoutes.post('/preview', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const { prompt } = body

  if (!prompt) {
    return c.json({ error: 'prompt is required' }, 400)
  }

  // Create temporary orchestrator for analysis
  const orchestrator = new MultiAgentOrchestrator()

  // We need to expose analysis method - for now, return basic analysis
  // In real implementation, we'd call orchestrator.analyze(prompt)
  const analysis: TaskAnalysis = {
    complexity: 'moderate',
    requiresDecomposition: true,
    estimatedSubtasks: 3,
    recommendedParallelism: 3,
    decompositionStrategy: 'file-based'
  }

  // Estimate cost
  const estimatedCost = estimateCost(analysis)

  return c.json({
    analysis,
    estimatedCost,
    recommendation: getRecommendation(analysis)
  })
})

/**
 * GET /api/agent/multi/status/:executionId - Get execution status
 */
multiAgentRoutes.get('/status/:executionId', async (c) => {
  const executionId = c.req.param('executionId')
  const orchestrator = activeExecutions.get(executionId)

  if (!orchestrator) {
    return c.json({ error: 'Execution not found' }, 404)
  }

  const status = orchestrator.getStatus()
  return c.json({ status })
})

/**
 * POST /api/agent/multi/abort/:executionId - Abort execution
 */
multiAgentRoutes.post('/abort/:executionId', async (c) => {
  const executionId = c.req.param('executionId')
  const orchestrator = activeExecutions.get(executionId)

  if (!orchestrator) {
    return c.json({ error: 'Execution not found' }, 404)
  }

  orchestrator.abort()
  activeExecutions.delete(executionId)

  return c.json({ success: true })
})

/**
 * GET /api/agent/multi/history - Get execution history (optional)
 *
 * Note: This is a placeholder. Real implementation would use a database.
 */
multiAgentRoutes.get('/history', async (c) => {
  // Placeholder - return empty history
  return c.json({
    executions: [],
    message: 'History feature not yet implemented'
  })
})

/**
 * GET /api/agent/multi/history/:executionId - Get specific execution details
 */
multiAgentRoutes.get('/history/:executionId', async (c) => {
  const executionId = c.req.param('executionId')

  // Placeholder - return not found
  return c.json({ error: 'Execution not found in history' }, 404)
})

/**
 * Estimate cost based on task analysis
 */
function estimateCost(analysis: TaskAnalysis): number {
  // Rough estimates based on model pricing
  const OPUS_INPUT_COST = 15 / 1_000_000 // $15 per 1M tokens
  const OPUS_OUTPUT_COST = 75 / 1_000_000 // $75 per 1M tokens
  const SONNET_INPUT_COST = 3 / 1_000_000 // $3 per 1M tokens
  const SONNET_OUTPUT_COST = 15 / 1_000_000 // $15 per 1M tokens

  // Estimate tokens per subtask
  const AVG_INPUT_TOKENS = 2000
  const AVG_OUTPUT_TOKENS = 1000

  if (!analysis.requiresDecomposition) {
    // Simple task - use orchestrator only
    return AVG_INPUT_TOKENS * OPUS_INPUT_COST + AVG_OUTPUT_TOKENS * OPUS_OUTPUT_COST
  }

  // Multi-agent task
  const subtaskCount = analysis.estimatedSubtasks

  // Orchestrator cost (analysis + aggregation)
  const orchestratorCost =
    2 * AVG_INPUT_TOKENS * OPUS_INPUT_COST +
    2 * AVG_OUTPUT_TOKENS * OPUS_OUTPUT_COST

  // Sub-agents cost
  const subAgentsCost =
    subtaskCount * AVG_INPUT_TOKENS * SONNET_INPUT_COST +
    subtaskCount * AVG_OUTPUT_TOKENS * SONNET_OUTPUT_COST

  return orchestratorCost + subAgentsCost
}

/**
 * Get recommendation based on analysis
 */
function getRecommendation(analysis: TaskAnalysis): string {
  if (!analysis.requiresDecomposition) {
    return 'This task is simple enough to execute directly without decomposition.'
  }

  const strategyReasons: Record<string, string> = {
    'file-based': 'Multiple files detected - parallelizing by file will be efficient.',
    'range-based': 'Line ranges detected - parallelizing by range will avoid conflicts.',
    'type-based': 'Entity types detected - parallelizing by type groups related work.'
  }

  return `Task will be decomposed into ~${analysis.estimatedSubtasks} subtasks using ${analysis.decompositionStrategy} strategy. ${
    strategyReasons[analysis.decompositionStrategy]
  } Parallelism level: ${analysis.recommendedParallelism}.`
}
