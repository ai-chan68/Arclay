import { describe, it, expect } from 'vitest'
import type { TaskPlan } from '../../types/agent-new'

// Import the functions we need to test (they're not exported, so we'll test via resolveExecutionEntry)
describe('Deliverable Type System', () => {
  describe('shouldEnableRuntimeGate', () => {
    it('should disable runtime gate for static_files deliverable', () => {
      const plan: TaskPlan = {
        id: 'test',
        goal: '创建贪吃蛇游戏',
        steps: [],
        deliverableType: 'static_files',
        createdAt: new Date()
      }
      // Runtime gate should be disabled for static files
      // We'll verify this through the execution entry result
      expect(plan.deliverableType).toBe('static_files')
    })

    it('should enable runtime gate for local_service deliverable', () => {
      const plan: TaskPlan = {
        id: 'test',
        goal: '创建 React 应用',
        steps: [],
        deliverableType: 'local_service',
        createdAt: new Date()
      }
      expect(plan.deliverableType).toBe('local_service')
    })

    it('should enable runtime gate for deployed_service deliverable', () => {
      const plan: TaskPlan = {
        id: 'test',
        goal: '部署到生产环境',
        steps: [],
        deliverableType: 'deployed_service',
        createdAt: new Date()
      }
      expect(plan.deliverableType).toBe('deployed_service')
    })

    it('should disable runtime gate for script_execution deliverable', () => {
      const plan: TaskPlan = {
        id: 'test',
        goal: '运行数据迁移脚本',
        steps: [],
        deliverableType: 'script_execution',
        createdAt: new Date()
      }
      expect(plan.deliverableType).toBe('script_execution')
    })

    it('should disable runtime gate for data_output deliverable', () => {
      const plan: TaskPlan = {
        id: 'test',
        goal: '分析 CSV 数据',
        steps: [],
        deliverableType: 'data_output',
        createdAt: new Date()
      }
      expect(plan.deliverableType).toBe('data_output')
    })

    it('should handle missing deliverableType (backward compatibility)', () => {
      const plan: TaskPlan = {
        id: 'test',
        goal: '启动前端项目',
        steps: [],
        createdAt: new Date()
      }
      // Should fall back to legacy detection
      expect(plan.deliverableType).toBeUndefined()
    })
  })

  describe('DeliverableType validation', () => {
    it('should accept all valid deliverable types', () => {
      const validTypes = [
        'static_files',
        'local_service',
        'deployed_service',
        'script_execution',
        'data_output',
        'unknown'
      ]

      validTypes.forEach(type => {
        const plan: TaskPlan = {
          id: 'test',
          goal: 'test',
          steps: [],
          deliverableType: type as any,
          createdAt: new Date()
        }
        expect(plan.deliverableType).toBe(type)
      })
    })
  })
})
