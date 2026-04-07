import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TaskPlan } from '../../../types/agent-new'
import { ClaudeAgent } from './claude'

function createPlan(): TaskPlan {
  return {
    id: 'plan-fixed-max-turns',
    goal: 'Implement a large refactor',
    steps: Array.from({ length: 40 }, (_, index) => ({
      id: `step_${index + 1}`,
      description: `Step ${index + 1}`,
      status: 'pending' as const,
    })),
    estimatedIterations: 120,
    createdAt: new Date('2026-03-31T00:00:00.000Z'),
  }
}

describe('ClaudeAgent maxTurns policy', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('uses a fixed maxTurns safety cap of 200 regardless of prompt complexity or plan size', async () => {
    const agent = new ClaudeAgent({
      provider: 'claude',
      apiKey: 'test-key',
      model: 'test-model',
    })

    vi.spyOn(agent as unknown as { syncSkillsToSession: (...args: unknown[]) => Promise<void> }, 'syncSkillsToSession')
      .mockResolvedValue(undefined)
    vi.spyOn(agent as unknown as { loadMcpServers: (...args: unknown[]) => Promise<Record<string, unknown>> }, 'loadMcpServers')
      .mockResolvedValue({})

    const queryOptions = await (agent as unknown as {
      buildQueryOptions: (
        cwd: string,
        options?: {
          complexityHint?: 'simple' | 'medium' | 'complex'
          plan?: TaskPlan
        },
        signal?: AbortSignal,
        claudeCodePath?: string,
        selectedSkillIds?: string[],
        providerSessionId?: string,
        prompt?: string
      ) => Promise<{ maxTurns?: number | null }>
    }).buildQueryOptions(
      '/tmp/easywork-session',
      {
        complexityHint: 'simple',
        plan: createPlan(),
      },
      undefined,
      undefined,
      undefined,
      'provider-session-1',
      'please read one file and then refactor the whole project'
    )

    expect(queryOptions.maxTurns).toBe(200)
  })
})
