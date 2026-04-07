/**
 * Lightweight cron parser for 5-field cron:
 * minute hour day-of-month month day-of-week
 */

type FieldType = 'minute' | 'hour' | 'dayOfMonth' | 'month' | 'dayOfWeek'

interface FieldConfig {
  min: number
  max: number
}

interface ParsedField {
  values: Set<number>
  isAny: boolean
}

export interface ParsedCron {
  minute: ParsedField
  hour: ParsedField
  dayOfMonth: ParsedField
  month: ParsedField
  dayOfWeek: ParsedField
}

export interface CronSuggestion {
  expr: string
  description: string
  confidence: 'high' | 'medium'
}

interface TimeParts {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  dayOfWeek: number
}

const FIELD_CONFIG: Record<FieldType, FieldConfig> = {
  minute: { min: 0, max: 59 },
  hour: { min: 0, max: 23 },
  dayOfMonth: { min: 1, max: 31 },
  month: { min: 1, max: 12 },
  dayOfWeek: { min: 0, max: 6 }, // 0 or 7 = Sunday
}

function normalizeDayOfWeek(value: number): number {
  return value === 7 ? 0 : value
}

function validateTimeZone(timezone: string): void {
  // Throws RangeError on invalid timezone.
  void new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(new Date())
}

function parseField(field: string, type: FieldType): ParsedField {
  const cfg = FIELD_CONFIG[type]

  if (field.trim() === '*') {
    const all = new Set<number>()
    for (let i = cfg.min; i <= cfg.max; i += 1) {
      all.add(i)
    }
    return { values: all, isAny: true }
  }

  const values = new Set<number>()
  const segments = field.split(',')

  for (const segmentRaw of segments) {
    const segment = segmentRaw.trim()
    if (!segment) {
      throw new Error(`Invalid cron segment in field ${type}`)
    }

    const stepParts = segment.split('/')
    const rangePart = stepParts[0]
    const step = stepParts.length > 1 ? Number(stepParts[1]) : 1

    if (!Number.isInteger(step) || step <= 0) {
      throw new Error(`Invalid step value in field ${type}`)
    }

    let rangeStart: number
    let rangeEnd: number

    if (rangePart === '*') {
      rangeStart = cfg.min
      rangeEnd = cfg.max
    } else if (rangePart.includes('-')) {
      const [startRaw, endRaw] = rangePart.split('-')
      const start = Number(startRaw)
      const end = Number(endRaw)
      if (!Number.isInteger(start) || !Number.isInteger(end)) {
        throw new Error(`Invalid range in field ${type}`)
      }
      rangeStart = start
      rangeEnd = end
    } else {
      const literal = Number(rangePart)
      if (!Number.isInteger(literal)) {
        throw new Error(`Invalid literal value in field ${type}`)
      }
      rangeStart = literal
      rangeEnd = literal
    }

    if (type === 'dayOfWeek') {
      rangeStart = normalizeDayOfWeek(rangeStart)
      rangeEnd = normalizeDayOfWeek(rangeEnd)
    }

    if (rangeStart < cfg.min || rangeStart > cfg.max || rangeEnd < cfg.min || rangeEnd > cfg.max) {
      throw new Error(`Value out of range in field ${type}`)
    }

    if (rangeStart <= rangeEnd) {
      for (let val = rangeStart; val <= rangeEnd; val += step) {
        values.add(val)
      }
    } else {
      // e.g. day-of-week 5-1
      for (let val = rangeStart; val <= cfg.max; val += step) {
        values.add(val)
      }
      for (let val = cfg.min; val <= rangeEnd; val += step) {
        values.add(val)
      }
    }
  }

  if (values.size === 0) {
    throw new Error(`No values parsed for field ${type}`)
  }

  return { values, isAny: false }
}

export function parseCronExpression(expr: string): ParsedCron {
  const fields = expr.trim().split(/\s+/)
  if (fields.length !== 5) {
    throw new Error('Cron expression must have exactly 5 fields')
  }

  return {
    minute: parseField(fields[0], 'minute'),
    hour: parseField(fields[1], 'hour'),
    dayOfMonth: parseField(fields[2], 'dayOfMonth'),
    month: parseField(fields[3], 'month'),
    dayOfWeek: parseField(fields[4], 'dayOfWeek'),
  }
}

function getTimePartsInTimeZone(date: Date, timezone: string): TimeParts {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })

  const parts = formatter.formatToParts(date)
  const getPart = (type: Intl.DateTimeFormatPartTypes): number => {
    const found = parts.find((p) => p.type === type)?.value
    if (!found) {
      throw new Error(`Missing date part: ${type}`)
    }
    return Number(found)
  }

  const year = getPart('year')
  const month = getPart('month')
  const day = getPart('day')
  const hour = getPart('hour')
  const minute = getPart('minute')

  // Day-of-week is calendar-only for local YYYY-MM-DD.
  const dayOfWeek = new Date(Date.UTC(year, month - 1, day)).getUTCDay()

  return { year, month, day, hour, minute, dayOfWeek }
}

function matchesCronDay(
  dayOfMonthField: ParsedField,
  dayOfWeekField: ParsedField,
  day: number,
  dayOfWeek: number
): boolean {
  const domMatch = dayOfMonthField.values.has(day)
  const dowMatch = dayOfWeekField.values.has(dayOfWeek)

  if (dayOfMonthField.isAny && dayOfWeekField.isAny) {
    return true
  }

  if (dayOfMonthField.isAny) {
    return dowMatch
  }

  if (dayOfWeekField.isAny) {
    return domMatch
  }

  // Standard cron semantics: day-of-month OR day-of-week when both are restricted.
  return domMatch || dowMatch
}

export function matchesCron(expr: string, date: Date, timezone: string): boolean {
  const parsed = parseCronExpression(expr)
  return matchesParsedCron(parsed, date, timezone)
}

export function matchesParsedCron(parsed: ParsedCron, date: Date, timezone: string): boolean {
  const parts = getTimePartsInTimeZone(date, timezone)

  if (!parsed.minute.values.has(parts.minute)) return false
  if (!parsed.hour.values.has(parts.hour)) return false
  if (!parsed.month.values.has(parts.month)) return false
  if (!matchesCronDay(parsed.dayOfMonth, parsed.dayOfWeek, parts.day, parts.dayOfWeek)) return false

  return true
}

export function getNextRunAt(
  expr: string,
  timezone: string,
  fromDate: Date = new Date(),
  maxLookaheadMinutes = 366 * 24 * 60
): Date {
  validateTimeZone(timezone)
  const parsed = parseCronExpression(expr)

  // Start from next minute boundary.
  const candidate = new Date(fromDate.getTime())
  candidate.setUTCSeconds(0, 0)
  candidate.setUTCMinutes(candidate.getUTCMinutes() + 1)

  for (let i = 0; i < maxLookaheadMinutes; i += 1) {
    if (matchesParsedCron(parsed, candidate, timezone)) {
      return new Date(candidate.getTime())
    }
    candidate.setUTCMinutes(candidate.getUTCMinutes() + 1)
  }

  throw new Error('Unable to find next run time within lookahead window')
}

export function getUpcomingRuns(
  expr: string,
  timezone: string,
  count: number,
  fromDate: Date = new Date()
): Date[] {
  if (!Number.isInteger(count) || count <= 0 || count > 20) {
    throw new Error('count must be an integer between 1 and 20')
  }

  const runs: Date[] = []
  let cursor = new Date(fromDate.getTime())
  for (let i = 0; i < count; i += 1) {
    const next = getNextRunAt(expr, timezone, cursor)
    runs.push(next)
    cursor = next
  }
  return runs
}

function sortedFieldValues(field: ParsedField): number[] {
  return Array.from(field.values).sort((a, b) => a - b)
}

function toRanges(values: number[]): Array<{ start: number; end: number }> {
  if (values.length === 0) return []
  const ranges: Array<{ start: number; end: number }> = []
  let start = values[0]
  let end = values[0]

  for (let i = 1; i < values.length; i += 1) {
    const current = values[i]
    if (current === end + 1) {
      end = current
    } else {
      ranges.push({ start, end })
      start = current
      end = current
    }
  }
  ranges.push({ start, end })
  return ranges
}

function formatMinuteValue(value: number): string {
  return `${value}分`
}

function formatHourValue(value: number): string {
  return `${value}点`
}

function formatDayOfMonthValue(value: number): string {
  return `${value}日`
}

function formatMonthValue(value: number): string {
  return `${value}月`
}

const WEEKDAY_LABELS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'] as const

function formatDayOfWeekValue(value: number): string {
  return WEEKDAY_LABELS[value] ?? `周${value}`
}

function formatValueRanges(
  values: number[],
  valueFormatter: (value: number) => string,
  joiner = '、'
): string {
  const ranges = toRanges(values)
  return ranges
    .map((range) => {
      if (range.start === range.end) {
        return valueFormatter(range.start)
      }
      return `${valueFormatter(range.start)}至${valueFormatter(range.end)}`
    })
    .join(joiner)
}

function detectUniformStep(values: number[], min: number): number | null {
  if (values.length < 2) return null
  if (values[0] !== min) return null

  const step = values[1] - values[0]
  if (step <= 0) return null
  for (let i = 1; i < values.length; i += 1) {
    if (values[i] - values[i - 1] !== step) return null
  }
  return step
}

function describeTimePart(parsed: ParsedCron): { text: string; fixedTime: string | null } {
  const minuteValues = sortedFieldValues(parsed.minute)
  const hourValues = sortedFieldValues(parsed.hour)

  const isSingleMinute = minuteValues.length === 1
  const isSingleHour = hourValues.length === 1

  if (isSingleMinute && isSingleHour) {
    const hh = String(hourValues[0]).padStart(2, '0')
    const mm = String(minuteValues[0]).padStart(2, '0')
    return { text: `${hh}:${mm}`, fixedTime: `${hh}:${mm}` }
  }

  if (parsed.hour.isAny && parsed.minute.isAny) {
    return { text: '每分钟', fixedTime: null }
  }

  if (parsed.hour.isAny && !parsed.minute.isAny) {
    const minuteStep = detectUniformStep(minuteValues, 0)
    if (minuteStep && minuteStep > 1) {
      return { text: `每${minuteStep}分钟`, fixedTime: null }
    }
    if (isSingleMinute) {
      return { text: `每小时${String(minuteValues[0]).padStart(2, '0')}分`, fixedTime: null }
    }
    return { text: `每小时在${formatValueRanges(minuteValues, formatMinuteValue)}执行`, fixedTime: null }
  }

  if (!parsed.hour.isAny && parsed.minute.isAny) {
    if (isSingleHour) {
      return { text: `${String(hourValues[0]).padStart(2, '0')}点每分钟`, fixedTime: null }
    }
    return { text: `在${formatValueRanges(hourValues, formatHourValue)}的每分钟执行`, fixedTime: null }
  }

  return {
    text: `在${formatValueRanges(hourValues, formatHourValue)}的${formatValueRanges(minuteValues, formatMinuteValue)}执行`,
    fixedTime: null,
  }
}

function describeDayPart(parsed: ParsedCron): { text: string; mode: 'daily' | 'weekly' | 'monthly' | 'mixed' } {
  if (parsed.dayOfMonth.isAny && parsed.dayOfWeek.isAny) {
    return { text: '每天', mode: 'daily' }
  }

  if (parsed.dayOfMonth.isAny && !parsed.dayOfWeek.isAny) {
    const weekdayValues = sortedFieldValues(parsed.dayOfWeek)
    return {
      text: `每周${formatValueRanges(weekdayValues, formatDayOfWeekValue)}`,
      mode: 'weekly',
    }
  }

  if (!parsed.dayOfMonth.isAny && parsed.dayOfWeek.isAny) {
    const dayValues = sortedFieldValues(parsed.dayOfMonth)
    return {
      text: `每月${formatValueRanges(dayValues, formatDayOfMonthValue)}`,
      mode: 'monthly',
    }
  }

  const dayValues = sortedFieldValues(parsed.dayOfMonth)
  const weekdayValues = sortedFieldValues(parsed.dayOfWeek)
  return {
    text: `每月${formatValueRanges(dayValues, formatDayOfMonthValue)}或每周${formatValueRanges(weekdayValues, formatDayOfWeekValue)}`,
    mode: 'mixed',
  }
}

function describeMonthPart(parsed: ParsedCron): string {
  if (parsed.month.isAny) return ''
  const values = sortedFieldValues(parsed.month)
  return `在${formatValueRanges(values, formatMonthValue)}`
}

export function explainCronExpression(expr: string, timezone: string): string {
  validateTimeZone(timezone)
  const parsed = parseCronExpression(expr)
  const monthPart = describeMonthPart(parsed)
  const dayPart = describeDayPart(parsed)
  const timePart = describeTimePart(parsed)

  if (!monthPart && timePart.fixedTime && (dayPart.mode === 'daily' || dayPart.mode === 'weekly' || dayPart.mode === 'monthly')) {
    return `${dayPart.text} ${timePart.fixedTime}（时区 ${timezone}）`
  }

  const segments = [
    monthPart,
    dayPart.text,
    timePart.text,
  ].filter(Boolean)

  return `${segments.join('，')}（时区 ${timezone}）`
}

function parseTimeInText(text: string): { hour: number; minute: number } | null {
  const hmMatch = text.match(/(\d{1,2})\s*[:：]\s*(\d{1,2})/)
  if (hmMatch) {
    const hour = Number(hmMatch[1])
    const minute = Number(hmMatch[2])
    if (Number.isInteger(hour) && Number.isInteger(minute) && hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
      return { hour, minute }
    }
  }

  const halfMatch = text.match(/(\d{1,2})\s*点\s*半/)
  if (halfMatch) {
    const hour = Number(halfMatch[1])
    if (Number.isInteger(hour) && hour >= 0 && hour <= 23) {
      return { hour, minute: 30 }
    }
  }

  const pointMatch = text.match(/(\d{1,2})\s*点(?:\s*(\d{1,2})\s*分?)?/)
  if (pointMatch) {
    const hour = Number(pointMatch[1])
    const minute = pointMatch[2] ? Number(pointMatch[2]) : 0
    if (Number.isInteger(hour) && Number.isInteger(minute) && hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
      return { hour, minute }
    }
  }

  return null
}

function weekdayTokenToCronValue(token: string): number | null {
  const normalized = token.trim()
  if (/^\d+$/.test(normalized)) {
    const num = Number(normalized)
    if (num >= 1 && num <= 7) return num === 7 ? 0 : num
    if (num === 0) return 0
    return null
  }

  const map: Record<string, number> = {
    '一': 1,
    '二': 2,
    '三': 3,
    '四': 4,
    '五': 5,
    '六': 6,
    '日': 0,
    '天': 0,
  }
  return map[normalized] ?? null
}

function addCronSuggestion(
  suggestions: CronSuggestion[],
  expr: string,
  timezone: string,
  confidence: 'high' | 'medium'
): void {
  if (suggestions.some((s) => s.expr === expr)) return
  suggestions.push({
    expr,
    description: explainCronExpression(expr, timezone),
    confidence,
  })
}

export function suggestCronExpressionsFromText(text: string, timezone: string): CronSuggestion[] {
  validateTimeZone(timezone)
  const input = text.trim()
  if (!input) return []

  const normalized = input.toLowerCase()
  const suggestions: CronSuggestion[] = []
  const time = parseTimeInText(input)
  const hour = time?.hour ?? 9
  const minute = time?.minute ?? 0
  const hasExplicitTime = !!time

  const everyNMinutes = normalized.match(/每隔\s*(\d{1,2})\s*分钟|every\s*(\d{1,2})\s*minutes?/)
  if (everyNMinutes) {
    const n = Number(everyNMinutes[1] || everyNMinutes[2])
    if (n >= 1 && n <= 59) {
      addCronSuggestion(suggestions, `*/${n} * * * *`, timezone, 'high')
    }
  }

  const everyNHours = normalized.match(/每隔\s*(\d{1,2})\s*小时|every\s*(\d{1,2})\s*hours?/)
  if (everyNHours) {
    const n = Number(everyNHours[1] || everyNHours[2])
    if (n >= 1 && n <= 23) {
      addCronSuggestion(suggestions, `${minute} */${n} * * *`, timezone, 'high')
    }
  }

  if (/每小时|hourly/.test(normalized)) {
    addCronSuggestion(suggestions, `${minute} * * * *`, timezone, hasExplicitTime ? 'high' : 'medium')
  }

  if (/工作日|周一到周五|周一至周五|weekday/.test(normalized)) {
    addCronSuggestion(suggestions, `${minute} ${hour} * * 1-5`, timezone, hasExplicitTime ? 'high' : 'medium')
  }

  const weeklyRange = input.match(/每周\s*([一二三四五六日天1-7])\s*(?:到|至|-)\s*([一二三四五六日天1-7])/)
  if (weeklyRange) {
    const start = weekdayTokenToCronValue(weeklyRange[1])
    const end = weekdayTokenToCronValue(weeklyRange[2])
    if (start !== null && end !== null) {
      addCronSuggestion(suggestions, `${minute} ${hour} * * ${start}-${end}`, timezone, hasExplicitTime ? 'high' : 'medium')
    }
  } else {
    const weeklySingle = input.match(/每周\s*([一二三四五六日天1-7])/)
    if (weeklySingle) {
      const day = weekdayTokenToCronValue(weeklySingle[1])
      if (day !== null) {
        addCronSuggestion(suggestions, `${minute} ${hour} * * ${day}`, timezone, hasExplicitTime ? 'high' : 'medium')
      }
    }
  }

  const monthly = input.match(/每月\s*(\d{1,2})\s*(?:号|日)/)
  if (monthly) {
    const day = Number(monthly[1])
    if (day >= 1 && day <= 31) {
      addCronSuggestion(suggestions, `${minute} ${hour} ${day} * *`, timezone, hasExplicitTime ? 'high' : 'medium')
    }
  }

  if (/每天|每日|daily|every day/.test(normalized)) {
    addCronSuggestion(suggestions, `${minute} ${hour} * * *`, timezone, hasExplicitTime ? 'high' : 'medium')
  }

  return suggestions
}

export function validateCronExpression(expr: string, timezone: string): { valid: true } | { valid: false; error: string } {
  try {
    validateTimeZone(timezone)
    parseCronExpression(expr)
    // Ensure at least one next run can be computed.
    void getNextRunAt(expr, timezone, new Date())
    return { valid: true }
  } catch (error) {
    return { valid: false, error: error instanceof Error ? error.message : 'Invalid cron expression' }
  }
}
