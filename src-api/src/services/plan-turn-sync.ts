import type { PlanRecord } from '../types/plan-store'
import { turnRuntimeStore } from './turn-runtime-store'

export function cancelTurnsForExpiredPlans(records: PlanRecord[]): number {
  let count = 0

  for (const record of records) {
    if (!record.turnId) continue
    const result = turnRuntimeStore.cancelTurn(
      record.turnId,
      record.reason || 'Plan expired before approval.'
    )
    if (result.status === 'ok') {
      count += 1
    }
  }

  return count
}
