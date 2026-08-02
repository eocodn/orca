import { createHash, randomBytes } from 'node:crypto'
import type { DeliveryRow, MessageRow, QuestionRow, RunRow } from './types'
import { parsePaneKey } from '../../../shared/stable-pane-id'
import { OrchestrationError } from './orchestration-error'

type RunListCursor = {
  createdAt: string
  id: string
}

// Leaf UUID remains stable when a tab is split; exact matching covers legacy keys that cannot be parsed.
export function isEquivalentPaneKey(a: string, b: string): boolean {
  if (a === b) {
    return true
  }
  const aLeaf = parsePaneKey(a)?.leafId
  const bLeaf = parsePaneKey(b)?.leafId
  return Boolean(aLeaf && bLeaf && aLeaf === bLeaf)
}
export function generateId(prefix: string): string {
  return `${prefix}_${randomBytes(6).toString('hex')}`
}

export function hashDispatchCapability(capability: string): string {
  return createHash('sha256').update(capability).digest('hex')
}

export function addLifecycleRejectionMarker(payload: string | null, code: string, reason: string): string {
  let parsed: Record<string, unknown> = {}
  try {
    const value: unknown = payload ? JSON.parse(payload) : {}
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      parsed = value as Record<string, unknown>
    }
  } catch {
    // Authority reconciliation only reaches this path with object payloads.
  }
  return JSON.stringify({
    ...parsed,
    _orcaLifecycleRejection: { code, reason }
  })
}

export function hasLifecycleRejectionMarker(payload: string | null): boolean {
  try {
    const value: unknown = JSON.parse(payload ?? 'null')
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return false
    }
    const marker = (value as Record<string, unknown>)._orcaLifecycleRejection
    return Boolean(
      marker &&
      typeof marker === 'object' &&
      !Array.isArray(marker) &&
      typeof (marker as Record<string, unknown>).code === 'string' &&
      typeof (marker as Record<string, unknown>).reason === 'string'
    )
  } catch {
    return false
  }
}

const SQLITE_UTC_TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?$/

export function exposeUtcTimestamp(timestamp: string | null): string | null {
  if (!timestamp || !SQLITE_UTC_TIMESTAMP_RE.test(timestamp)) {
    return timestamp
  }
  return `${timestamp.replace(' ', 'T')}Z`
}

export function exposeMessageTimestamps(message: MessageRow): MessageRow {
  // Why: SQLite stores UTC as timezone-less space format for SQL ordering, but RPC/CLI consumers need an explicit offset.
  return {
    ...message,
    created_at: exposeUtcTimestamp(message.created_at) ?? message.created_at,
    delivered_at: exposeUtcTimestamp(message.delivered_at)
  }
}

export function exposeMessageListTimestamps(messages: MessageRow[]): MessageRow[] {
  return messages.map(exposeMessageTimestamps)
}

export function exposeRunTimestamps(run: RunRow): RunRow {
  return {
    ...run,
    created_at: exposeUtcTimestamp(run.created_at) ?? run.created_at,
    updated_at: exposeUtcTimestamp(run.updated_at) ?? run.updated_at
  }
}

export function encodeRunListCursor(run: RunRow): string {
  const cursor: RunListCursor = { createdAt: run.created_at, id: run.id }
  return Buffer.from(JSON.stringify(cursor)).toString('base64url')
}

export function decodeRunListCursor(value: string): RunListCursor {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'))
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      typeof (parsed as RunListCursor).createdAt !== 'string' ||
      typeof (parsed as RunListCursor).id !== 'string'
    ) {
      throw new Error('invalid cursor shape')
    }
    return parsed as RunListCursor
  } catch {
    throw new OrchestrationError('cursor_invalid', 'The Run list cursor is invalid.')
  }
}

export function exposeDeliveryTimestamps(delivery: DeliveryRow): DeliveryRow {
  return {
    ...delivery,
    created_at: exposeUtcTimestamp(delivery.created_at) ?? delivery.created_at,
    acknowledged_at: exposeUtcTimestamp(delivery.acknowledged_at)
  }
}

export function exposeQuestionTimestamps(question: QuestionRow): QuestionRow {
  return {
    ...question,
    created_at: exposeUtcTimestamp(question.created_at) ?? question.created_at,
    answered_at: exposeUtcTimestamp(question.answered_at),
    closed_at: exposeUtcTimestamp(question.closed_at)
  }
}

export function normalizeLegacyQuestionText(value: string): string {
  return value.replace(/\r\n/g, '\n').trim()
}

export function normalizeLegacyQuestionOptions(options: unknown): string {
  if (!Array.isArray(options) || !options.every((option) => typeof option === 'string')) {
    return '[]'
  }
  return JSON.stringify(options.map((option) => option.trim()))
}

export function legacyMessageMatchesQuestion(
  message: MessageRow,
  question: string,
  options: string[],
  recipientHandles: readonly string[]
): boolean {
  if (
    !recipientHandles.includes(message.to_handle) ||
    normalizeLegacyQuestionText(message.body) !== normalizeLegacyQuestionText(question)
  ) {
    return false
  }
  try {
    const payload = JSON.parse(message.payload ?? '{}') as { options?: unknown }
    return (
      normalizeLegacyQuestionOptions(payload.options) === normalizeLegacyQuestionOptions(options)
    )
  } catch {
    return false
  }
}

