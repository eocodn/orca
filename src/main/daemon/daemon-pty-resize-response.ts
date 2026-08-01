export function parseDaemonResizeIfCurrentResponse(value: unknown): boolean {
  if (
    typeof value !== 'object' ||
    value === null ||
    typeof (value as { applied?: unknown }).applied !== 'boolean'
  ) {
    throw new Error('invalid_daemon_resize_if_current_response')
  }
  return (value as { applied: boolean }).applied
}
