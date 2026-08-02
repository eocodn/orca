import type { AutomationSchedulePreset } from './automations-types'
import {
  DAY_CODES,
  parseCronExpression,
  parseSchedule,
  type ParsedCron,
  type AutomationCronScheduleClassification
} from './automation-schedule-parser'
import {
  cronHasPossibleOccurrence,
  parseAutomationRrule
} from './automation-schedule-occurrence'

function formatTime(hour: number, minute: number): string {
  const date = new Date()
  date.setHours(hour, minute, 0, 0)
  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit'
  }).format(date)
}

function getSingleSetValue(values: Set<number>): number | null {
  if (values.size !== 1) {
    return null
  }
  return values.values().next().value as number
}

function setContainsExactly(values: Set<number>, expected: readonly number[]): boolean {
  if (values.size !== expected.length) {
    return false
  }
  return expected.every((value) => values.has(value))
}

function setContainsRange(values: Set<number>, min: number, max: number): boolean {
  if (values.size !== max - min + 1) {
    return false
  }
  for (let value = min; value <= max; value += 1) {
    if (!values.has(value)) {
      return false
    }
  }
  return true
}

function formatParsedRruleSchedule(schedule: ReturnType<typeof parseAutomationRrule>): string {
  if (schedule.preset === 'hourly') {
    return `Hourly at :${String(schedule.minute).padStart(2, '0')}`
  }
  const time = formatTime(schedule.hour, schedule.minute)
  if (schedule.preset === 'daily') {
    return `Daily at ${time}`
  }
  if (schedule.preset === 'weekdays') {
    return `Weekdays at ${time}`
  }
  const day = new Intl.DateTimeFormat(undefined, { weekday: 'long' }).format(
    new Date(2026, 0, 4 + schedule.dayOfWeek)
  )
  return `${day}s at ${time}`
}

function classifyParsedCronSchedule(rule: ParsedCron): AutomationCronScheduleClassification {
  if (!cronHasPossibleOccurrence(rule, Date.now())) {
    return { kind: 'invalid', label: 'Invalid schedule' }
  }
  const minute = getSingleSetValue(rule.minutes)
  const hour = getSingleSetValue(rule.hours)
  const unrestrictedDayOfMonth = !rule.dayOfMonthRestricted
  const unrestrictedMonth = setContainsRange(rule.months, 1, 12)
  const unrestrictedDayOfWeek = !rule.dayOfWeekRestricted
  const unrestrictedCalendar = unrestrictedDayOfMonth && unrestrictedMonth
  if (
    minute !== null &&
    setContainsRange(rule.hours, 0, 23) &&
    unrestrictedCalendar &&
    unrestrictedDayOfWeek
  ) {
    return {
      kind: 'hourly',
      minute,
      label: `Hourly at :${String(minute).padStart(2, '0')}`
    }
  }
  if (minute !== null && hour !== null && unrestrictedCalendar) {
    const time = formatTime(hour, minute)
    if (unrestrictedDayOfWeek) {
      return { kind: 'daily', hour, minute, label: `Daily at ${time}` }
    }
    if (setContainsExactly(rule.daysOfWeek, [1, 2, 3, 4, 5])) {
      return { kind: 'weekdays', hour, minute, label: `Weekdays at ${time}` }
    }
    const dayOfWeek = getSingleSetValue(rule.daysOfWeek)
    if (dayOfWeek !== null) {
      const day = new Intl.DateTimeFormat(undefined, { weekday: 'long' }).format(
        new Date(2026, 0, 4 + dayOfWeek)
      )
      return {
        kind: 'weekly',
        hour,
        minute,
        dayOfWeek,
        label: `${day}s at ${time}`
      }
    }
  }
  return { kind: 'custom', label: 'Custom schedule' }
}

export function classifyAutomationCronSchedule(
  schedule: string
): AutomationCronScheduleClassification {
  try {
    return classifyParsedCronSchedule(parseCronExpression(schedule.trim()))
  } catch {
    return { kind: 'invalid', label: 'Invalid schedule' }
  }
}

export function formatAutomationSchedule(scheduleExpression: string): string {
  try {
    const trimmed = scheduleExpression.trim()
    const schedule = parseSchedule(trimmed)
    if (schedule.kind === 'cron') {
      return classifyParsedCronSchedule(schedule).label
    }
    return formatParsedRruleSchedule(parseAutomationRrule(trimmed))
  } catch {
    return 'Invalid schedule'
  }
}
