import { describe, it, expect } from 'vitest'
import {
  parseCronExpression,
  matchesCron,
  getNextRunAt,
  getUpcomingRuns,
} from '../cron-utils'

describe('cron-utils', () => {
  describe('parseCronExpression', () => {
    it('should parse wildcard expression', () => {
      const parsed = parseCronExpression('* * * * *')
      expect(parsed.minute.isAny).toBe(true)
      expect(parsed.hour.isAny).toBe(true)
      expect(parsed.dayOfMonth.isAny).toBe(true)
      expect(parsed.month.isAny).toBe(true)
      expect(parsed.dayOfWeek.isAny).toBe(true)
    })

    it('should parse literal values', () => {
      const parsed = parseCronExpression('30 14 1 6 5')
      expect(parsed.minute.values.has(30)).toBe(true)
      expect(parsed.hour.values.has(14)).toBe(true)
      expect(parsed.dayOfMonth.values.has(1)).toBe(true)
      expect(parsed.month.values.has(6)).toBe(true)
      expect(parsed.dayOfWeek.values.has(5)).toBe(true)
    })

    it('should parse range values', () => {
      const parsed = parseCronExpression('0-30 9-17 * * 1-5')
      expect(parsed.minute.values.has(0)).toBe(true)
      expect(parsed.minute.values.has(15)).toBe(true)
      expect(parsed.minute.values.has(30)).toBe(true)
      expect(parsed.hour.values.has(9)).toBe(true)
      expect(parsed.hour.values.has(17)).toBe(true)
      expect(parsed.dayOfWeek.values.has(1)).toBe(true)
      expect(parsed.dayOfWeek.values.has(5)).toBe(true)
    })

    it('should parse step values', () => {
      const parsed = parseCronExpression('*/15 */2 * * *')
      expect(parsed.minute.values.has(0)).toBe(true)
      expect(parsed.minute.values.has(15)).toBe(true)
      expect(parsed.minute.values.has(30)).toBe(true)
      expect(parsed.minute.values.has(45)).toBe(true)
      expect(parsed.hour.values.has(0)).toBe(true)
      expect(parsed.hour.values.has(2)).toBe(true)
      expect(parsed.hour.values.has(22)).toBe(true)
    })

    it('should parse comma-separated values', () => {
      const parsed = parseCronExpression('0,15,30,45 9,12,18 * * *')
      expect(parsed.minute.values.size).toBe(4)
      expect(parsed.minute.values.has(0)).toBe(true)
      expect(parsed.minute.values.has(15)).toBe(true)
      expect(parsed.hour.values.size).toBe(3)
      expect(parsed.hour.values.has(9)).toBe(true)
      expect(parsed.hour.values.has(12)).toBe(true)
    })

    it('should normalize day-of-week 7 to 0', () => {
      const parsed = parseCronExpression('0 0 * * 7')
      expect(parsed.dayOfWeek.values.has(0)).toBe(true)
      expect(parsed.dayOfWeek.values.has(7)).toBe(false)
    })

    it('should throw on invalid field count', () => {
      expect(() => parseCronExpression('* * *')).toThrow('must have exactly 5 fields')
      expect(() => parseCronExpression('* * * * * *')).toThrow('must have exactly 5 fields')
    })

    it('should throw on invalid range', () => {
      expect(() => parseCronExpression('60 * * * *')).toThrow('out of range')
      expect(() => parseCronExpression('* 24 * * *')).toThrow('out of range')
      expect(() => parseCronExpression('* * 32 * *')).toThrow('out of range')
      expect(() => parseCronExpression('* * * 13 *')).toThrow('out of range')
      expect(() => parseCronExpression('* * * * 8')).toThrow('out of range')
    })

    it('should throw on invalid step', () => {
      expect(() => parseCronExpression('*/0 * * * *')).toThrow('Invalid step')
      expect(() => parseCronExpression('*/-1 * * * *')).toThrow('Invalid step')
    })
  })

  describe('matchesCron', () => {
    it('should match wildcard expression', () => {
      const date = new Date('2024-06-15T14:30:00Z')
      expect(matchesCron('* * * * *', date, 'UTC')).toBe(true)
    })

    it('should match specific time', () => {
      const date = new Date('2024-06-15T14:30:00Z')
      expect(matchesCron('30 14 * * *', date, 'UTC')).toBe(true)
      expect(matchesCron('31 14 * * *', date, 'UTC')).toBe(false)
      expect(matchesCron('30 15 * * *', date, 'UTC')).toBe(false)
    })

    it('should match day of month', () => {
      const date = new Date('2024-06-15T14:30:00Z')
      expect(matchesCron('30 14 15 * *', date, 'UTC')).toBe(true)
      expect(matchesCron('30 14 16 * *', date, 'UTC')).toBe(false)
    })

    it('should match month', () => {
      const date = new Date('2024-06-15T14:30:00Z')
      expect(matchesCron('30 14 * 6 *', date, 'UTC')).toBe(true)
      expect(matchesCron('30 14 * 7 *', date, 'UTC')).toBe(false)
    })

    it('should match day of week', () => {
      // 2024-06-15 is Saturday (6)
      const date = new Date('2024-06-15T14:30:00Z')
      expect(matchesCron('30 14 * * 6', date, 'UTC')).toBe(true)
      expect(matchesCron('30 14 * * 0', date, 'UTC')).toBe(false)
    })

    it('should handle timezone conversion', () => {
      // 2024-06-15T14:30:00Z = 2024-06-15 22:30 in Asia/Shanghai (UTC+8)
      const date = new Date('2024-06-15T14:30:00Z')
      expect(matchesCron('30 22 * * *', date, 'Asia/Shanghai')).toBe(true)
      expect(matchesCron('30 14 * * *', date, 'Asia/Shanghai')).toBe(false)
    })
  })

  describe('getNextRunAt', () => {
    it('should find next run for every minute', () => {
      const from = new Date('2024-06-15T14:30:00Z')
      const next = getNextRunAt('* * * * *', 'UTC', from)
      expect(next.toISOString()).toBe('2024-06-15T14:31:00.000Z')
    })

    it('should find next run for specific time', () => {
      const from = new Date('2024-06-15T14:30:00Z')
      const next = getNextRunAt('0 15 * * *', 'UTC', from)
      expect(next.toISOString()).toBe('2024-06-15T15:00:00.000Z')
    })

    it('should find next run on next day', () => {
      const from = new Date('2024-06-15T23:30:00Z')
      const next = getNextRunAt('0 9 * * *', 'UTC', from)
      expect(next.toISOString()).toBe('2024-06-16T09:00:00.000Z')
    })

    it('should find next run for specific day of week', () => {
      // 2024-06-15 is Saturday, next Monday is 2024-06-17
      const from = new Date('2024-06-15T14:30:00Z')
      const next = getNextRunAt('0 9 * * 1', 'UTC', from)
      expect(next.toISOString()).toBe('2024-06-17T09:00:00.000Z')
    })

    it('should throw if no match within lookahead', () => {
      const from = new Date('2024-06-15T14:30:00Z')
      expect(() => getNextRunAt('0 0 31 2 *', 'UTC', from, 100)).toThrow('Unable to find next run time')
    })

    it('should throw on invalid timezone', () => {
      const from = new Date('2024-06-15T14:30:00Z')
      expect(() => getNextRunAt('* * * * *', 'Invalid/Timezone', from)).toThrow()
    })
  })

  describe('getUpcomingRuns', () => {
    it('should return multiple upcoming runs', () => {
      const from = new Date('2024-06-15T14:30:00Z')
      const runs = getUpcomingRuns('0 9 * * *', 'UTC', 3, from)
      expect(runs).toHaveLength(3)
      expect(runs[0].toISOString()).toBe('2024-06-16T09:00:00.000Z')
      expect(runs[1].toISOString()).toBe('2024-06-17T09:00:00.000Z')
      expect(runs[2].toISOString()).toBe('2024-06-18T09:00:00.000Z')
    })

    it('should throw on invalid count', () => {
      const from = new Date('2024-06-15T14:30:00Z')
      expect(() => getUpcomingRuns('* * * * *', 'UTC', 0, from)).toThrow('count must be')
      expect(() => getUpcomingRuns('* * * * *', 'UTC', 21, from)).toThrow('count must be')
      expect(() => getUpcomingRuns('* * * * *', 'UTC', -1, from)).toThrow('count must be')
    })

    it('should handle every 15 minutes', () => {
      const from = new Date('2024-06-15T14:00:00Z')
      const runs = getUpcomingRuns('*/15 * * * *', 'UTC', 4, from)
      expect(runs).toHaveLength(4)
      expect(runs[0].toISOString()).toBe('2024-06-15T14:15:00.000Z')
      expect(runs[1].toISOString()).toBe('2024-06-15T14:30:00.000Z')
      expect(runs[2].toISOString()).toBe('2024-06-15T14:45:00.000Z')
      expect(runs[3].toISOString()).toBe('2024-06-15T15:00:00.000Z')
    })
  })
})
