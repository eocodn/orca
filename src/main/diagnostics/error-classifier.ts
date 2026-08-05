import type { ErrorClass } from '../../shared/telemetry-events'

export type ClassifiedError = { error_class: ErrorClass }

export function classifyError(err: unknown): ClassifiedError {
  if (err === null || err === undefined) return { error_class: 'unknown' }
  const code = typeof err === 'object' && 'code' in err ? (err as { code?: unknown }).code : undefined
  const syscall =
    typeof err === 'object' && 'syscall' in err ? (err as { syscall?: unknown }).syscall : undefined
  const message =
    typeof err === 'object' && 'message' in err ? (err as { message?: unknown }).message : undefined
  if (
    code === 'ENOENT' &&
    (typeof syscall !== 'string' || syscall.toLowerCase().startsWith('spawn'))
  ) return { error_class: 'binary_not_found' }
  if (typeof message === 'string' && /\bspawn\b/i.test(message) && /\benoent\b/i.test(message)) {
    return { error_class: 'binary_not_found' }
  }
  return { error_class: 'unknown' }
}
