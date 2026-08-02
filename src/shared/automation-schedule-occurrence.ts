import {
  CRON_SCAN_DAYS,
  CRON_SCAN_MINUTES,
  DAY_CODES,
  DAY_MS,
  HOUR_MS,
  MINUTE_MS,
  parseSchedule,
  type ParsedCron,
  type ParsedRrule
} from './automation-schedule-parser'
import type { AutomationSchedulePreset } from './automations-types'

export function isValidAutomationSchedule(schedule: string): boolean {
  try {
    const parsed = parseSchedule(schedule)
    if (parsed.kind === 'cron' && !cronHasPossibleOccurrence(parsed, Date.now())) {
      throw new Error('Cron schedule has no possible run.')
    }
    return true
  } catch {
    return false
  }
}

export function isValidAutomationCronSchedule(schedule: string): boolean {
  try {
    const parsed = parseCronExpression(schedule.trim())
    return cronHasPossibleOccurrence(parsed, Date.now())
  } catch {
    return false
  }
}

export function parseAutomationRrule(rrule: string): {
  preset: AutomationSchedulePreset
  hour: number
  minute: number
  dayOfWeek: number
} {
  const rule = parseRrule(rrule)
  if (rule.freq === 'HOURLY') {
    return { preset: 'hourly', hour: rule.byHour, minute: rule.byMinute, dayOfWeek: 1 }
  }
  if (rule.freq === 'DAILY') {
    return { preset: 'daily', hour: rule.byHour, minute: rule.byMinute, dayOfWeek: 1 }
  }
  if (rule.byDay.join(',') === WEEKDAY_CODES.join(',')) {
    return { preset: 'weekdays', hour: rule.byHour, minute: rule.byMinute, dayOfWeek: 1 }
  }
  if (rule.byDay.length !== 1) {
    throw new Error('Invalid recurrence day.')
  }
  const dayCode = rule.byDay[0]
  const dayOfWeek = DAY_CODES.indexOf(dayCode as (typeof DAY_CODES)[number])
  if (dayOfWeek < 0) {
    throw new Error('Invalid recurrence day.')
  }
  return {
    preset: 'weekly',
    hour: rule.byHour,
    minute: rule.byMinute,
    dayOfWeek
  }
}

export function tryParseAutomationRrule(
  rrule: string
): ReturnType<typeof parseAutomationRrule> | null {
  try {
    return parseAutomationRrule(rrule)
  } catch {
    return null
  }
}

function atLocalTime(dayMs: number, hour: number, minute: number): number {
  const date = new Date(dayMs)
  date.setHours(hour, minute, 0, 0)
  return date.getTime()
}

function startOfLocalDay(timestamp: number): number {
  const date = new Date(timestamp)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

function dayMatches(rule: ParsedRrule, timestamp: number): boolean {
  if (rule.freq === 'DAILY') {
    return true
  }
  const code = DAY_CODES[new Date(timestamp).getDay()]
  return rule.byDay.includes(code)
}

function scanDayCandidates(rule: ParsedRrule, anchor: number, direction: 1 | -1): number | null {
  let day = startOfLocalDay(anchor)
  for (let i = 0; i < 370; i += 1) {
    const candidate = atLocalTime(day, rule.byHour, rule.byMinute)
    if (dayMatches(rule, candidate)) {
      if (direction === 1 && candidate > anchor) {
        return candidate
      }
      if (direction === -1 && candidate <= anchor) {
        return candidate
      }
    }
    day += direction * DAY_MS
  }
  return null
}

function floorToMinute(timestamp: number): number {
  const date = new Date(timestamp)
  date.setSeconds(0, 0)
  return date.getTime()
}

function cronMatches(rule: ParsedCron, timestamp: number): boolean {
  if (!cronDateMatches(rule, timestamp)) {
    return false
  }
  const date = new Date(timestamp)
  return rule.hours.has(date.getHours()) && rule.minutes.has(date.getMinutes())
}

function cronDateMatches(rule: ParsedCron, timestamp: number): boolean {
  const date = new Date(timestamp)
  if (!rule.months.has(date.getMonth() + 1)) {
    return false
  }
  const dayOfMonthMatches = rule.daysOfMonth.has(date.getDate())
  const dayOfWeekMatches = rule.daysOfWeek.has(date.getDay())
  if (rule.dayOfMonthRestricted && rule.dayOfWeekRestricted) {
    return dayOfMonthMatches || dayOfWeekMatches
  }
  return dayOfMonthMatches && dayOfWeekMatches
}

export function cronHasPossibleOccurrence(rule: ParsedCron, anchor: number): boolean {
  let day = startOfLocalDay(anchor)
  for (let i = 0; i < CRON_SCAN_DAYS; i += 1) {
    if (cronDateMatches(rule, day)) {
      return true
    }
    day += DAY_MS
  }
  return false
}

export function buildAutomationRrule(args: {
  preset: Exclude<AutomationSchedulePreset, 'custom'>
  hour: number
  minute: number
  dayOfWeek?: number
}): string {
  const hour = Math.max(0, Math.min(23, Math.floor(args.hour)))
  const minute = Math.max(0, Math.min(59, Math.floor(args.minute)))
  if (args.preset === 'hourly') {
    return `FREQ=HOURLY;BYMINUTE=${minute}`
  }
  if (args.preset === 'weekdays') {
    return `FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;BYHOUR=${hour};BYMINUTE=${minute}`
  }
  if (args.preset === 'weekly') {
    const day = DAY_CODES[Math.max(0, Math.min(6, Math.floor(args.dayOfWeek ?? 1)))]
    return `FREQ=WEEKLY;BYDAY=${day};BYHOUR=${hour};BYMINUTE=${minute}`
  }
  return `FREQ=DAILY;BYHOUR=${hour};BYMINUTE=${minute}`
}

export function buildAutomationCronSchedule(args: {
  preset: Exclude<AutomationSchedulePreset, 'custom'>
  hour: number
  minute: number
  dayOfWeek?: number
}): string {
  const hour = Math.max(0, Math.min(23, Math.floor(args.hour)))
  const minute = Math.max(0, Math.min(59, Math.floor(args.minute)))
  if (args.preset === 'hourly') {
    return `${minute} * * * *`
  }
  if (args.preset === 'weekdays') {
    return `${minute} ${hour} * * 1-5`
  }
  if (args.preset === 'weekly') {
    const day = Math.max(0, Math.min(6, Math.floor(args.dayOfWeek ?? 1)))
    return `${minute} ${hour} * * ${day}`
  }
  return `${minute} ${hour} * * *`
}

export function nextAutomationOccurrenceAfter(
  rrule: string,
  dtstart: number,
  after: number
): number {
  const rule = parseSchedule(rrule)
  if (rule.kind === 'cron') {
    let candidate = floorToMinute(Math.max(dtstart, after))
    if (candidate <= after) {
      candidate += MINUTE_MS
    }
    if (candidate < dtstart) {
      candidate = floorToMinute(dtstart)
      if (candidate < dtstart) {
        candidate += MINUTE_MS
      }
    }
    for (let i = 0; i < CRON_SCAN_MINUTES; i += 1) {
      if (cronMatches(rule, candidate)) {
        return candidate
      }
      candidate += MINUTE_MS
    }
    throw new Error('Unable to compute next automation run.')
  }
  if (rule.freq === 'HOURLY') {
    const start = Math.max(dtstart, after)
    const base = new Date(start)
    base.setMinutes(rule.byMinute, 0, 0)
    let candidate = base.getTime()
    if (candidate <= after || candidate < dtstart) {
      candidate += HOUR_MS
    }
    return candidate
  }
  const candidate = scanDayCandidates(rule, Math.max(dtstart - 1, after), 1)
  if (candidate === null) {
    throw new Error('Unable to compute next automation run.')
  }
  return candidate
}

export function latestAutomationOccurrenceAtOrBefore(
  rrule: string,
  dtstart: number,
  now: number
): number | null {
  if (now < dtstart) {
    return null
  }
  const rule = parseSchedule(rrule)
  if (rule.kind === 'cron') {
    let candidate = floorToMinute(now)
    for (let i = 0; i < CRON_SCAN_MINUTES && candidate >= dtstart; i += 1) {
      if (cronMatches(rule, candidate)) {
        return candidate
      }
      candidate -= MINUTE_MS
    }
    return null
  }
  if (rule.freq === 'HOURLY') {
    const base = new Date(now)
    base.setMinutes(rule.byMinute, 0, 0)
    let candidate = base.getTime()
    if (candidate > now) {
      candidate -= HOUR_MS
    }
    return candidate >= dtstart ? candidate : null
  }
  const candidate = scanDayCandidates(rule, now, -1)
  return candidate !== null && candidate >= dtstart ? candidate : null
}
