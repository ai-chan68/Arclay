/**
 * Unit tests for TaskAnalyzer
 */

import { describe, it, expect } from 'vitest'
import { TaskAnalyzer } from '../task-analyzer'

describe('TaskAnalyzer', () => {
  const analyzer = new TaskAnalyzer()

  describe('analyze', () => {
    it('should detect simple tasks', () => {
      const result = analyzer.analyze('Explain this function')

      expect(result.complexity).toBe('simple')
      expect(result.requiresDecomposition).toBe(false)
      expect(result.estimatedSubtasks).toBe(1)
    })

    it('should detect complex tasks with multiple files', () => {
      const result = analyzer.analyze(
        'Update components A.tsx, B.tsx, and C.tsx to use the new API'
      )

      expect(result.complexity).toBe('complex')
      expect(result.requiresDecomposition).toBe(true)
      expect(result.decompositionStrategy).toBe('file-based')
      expect(result.estimatedSubtasks).toBeGreaterThan(1)
    })

    it('should detect range-based decomposition', () => {
      const result = analyzer.analyze(
        'Refactor lines 100-200 in the file'
      )

      expect(result.decompositionStrategy).toBe('range-based')
    })

    it('should detect type-based decomposition', () => {
      const result = analyzer.analyze(
        'Add tests for all components'
      )

      expect(result.decompositionStrategy).toBe('type-based')
    })

    it('should recommend appropriate parallelism', () => {
      const result = analyzer.analyze(
        'Refactor all components in the project'
      )

      expect(result.recommendedParallelism).toBeGreaterThanOrEqual(1)
      expect(result.recommendedParallelism).toBeLessThanOrEqual(5)
    })
  })
})
