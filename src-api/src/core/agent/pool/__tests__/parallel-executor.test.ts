/**
 * Unit tests for ParallelExecutor
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { ParallelExecutor } from '../parallel-executor'
import type { SubTask } from '@shared-types'

describe('ParallelExecutor', () => {
  let executor: ParallelExecutor

  beforeEach(() => {
    executor = new ParallelExecutor(2, 5000)
  })

  describe('execute', () => {
    it('should execute subtasks in parallel', async () => {
      const subtasks: SubTask[] = [
        {
          id: '1',
          parentTaskId: 'parent',
          description: 'Task 1',
          scope: {},
          dependencies: [],
          priority: 'high'
        },
        {
          id: '2',
          parentTaskId: 'parent',
          description: 'Task 2',
          scope: {},
          dependencies: [],
          priority: 'medium'
        }
      ]

      const results = await executor.execute(subtasks)

      expect(results).toHaveLength(2)
      results.forEach(result => {
        expect(result.status).toBe('success')
      })
    })

    it('should respect max concurrency', async () => {
      const subtasks: SubTask[] = Array.from({ length: 5 }, (_, i) => ({
        id: `${i}`,
        parentTaskId: 'parent',
        description: `Task ${i}`,
        scope: {},
        dependencies: [],
        priority: 'medium' as const
      }))

      let maxConcurrent = 0
      let currentConcurrent = 0

      const results = await executor.execute(subtasks, {
        onSubtaskStart: () => {
          currentConcurrent++
          maxConcurrent = Math.max(maxConcurrent, currentConcurrent)
        },
        onSubtaskComplete: () => {
          currentConcurrent--
        }
      })

      expect(maxConcurrent).toBeLessThanOrEqual(2)
      expect(results).toHaveLength(5)
    })

    it('should handle abort', async () => {
      const subtasks: SubTask[] = [
        {
          id: '1',
          parentTaskId: 'parent',
          description: 'Task 1',
          scope: {},
          dependencies: [],
          priority: 'high'
        }
      ]

      const executionPromise = executor.execute(subtasks)

      // Abort after a short delay
      setTimeout(() => executor.abort(), 100)

      const results = await executionPromise

      // Should complete without error even when aborted
      expect(results).toBeDefined()
    })
  })
})
