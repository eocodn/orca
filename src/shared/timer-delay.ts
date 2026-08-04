export const MAX_TIMER_DELAY_MS = 2_147_483_647

export function isSafeTimerDelayMs(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= MAX_TIMER_DELAY_MS
  )
}

// Why: mirrors the CLI's own `Number()` coercion for generic `--timeout-ms`
// flags (cli/flags.ts getOptionalPositiveIntegerFlag). Text that coerces to an
// exact integer — `1000.0`, `600000.000000000000001` — is the budget the CLI
// will actually wait on, so rejecting it here would leave the caller's timer
// shorter than the CLI's and cut the request short.
export function parsePositiveSafeIntegerNumericText(raw: string): number | null {
  const value = Number(raw)
  return Number.isSafeInteger(value) && value > 0 ? value : null
}
