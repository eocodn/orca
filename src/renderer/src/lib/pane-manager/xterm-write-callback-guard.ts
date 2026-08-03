import { recordRendererCrashBreadcrumb } from '@/lib/crash-breadcrumb-recorder'

// Why: xterm's WriteBuffer._innerWrite invokes write-completion callbacks with
// no try/catch; a synchronous throw skips the loop's tail re-schedule, and
// write() only re-arms processing when the buffer is EMPTY — which a stalled
// buffer never is again. One escaping throw therefore permanently freezes the
// pane: output stops rendering and a pending replay guard never releases, so
// the pane silently eats every keystroke while the shell stays alive
// (Discord #performance / issue #2836). Verified against the vendored xterm
// 6.1.0-beta.287 in xterm-write-buffer-stall.repro.test.ts.
const MAX_REPORTS_PER_CONTEXT = 5
type FailureState = { failures: number; quarantined: boolean }

let reportCountsByContext = new Map<string, number>()
let reportCountsByScope = new WeakMap<object, Map<string, number>>()
let failureStatesByScope = new WeakMap<object, Map<string, FailureState>>()

function getScopedFailureState(scope: object, context: string): FailureState {
  let states = failureStatesByScope.get(scope)
  if (!states) {
    states = new Map()
    failureStatesByScope.set(scope, states)
  }
  let state = states.get(context)
  if (!state) {
    state = { failures: 0, quarantined: false }
    states.set(context, state)
  }
  return state
}

function incrementReportCount(scope: object | undefined, context: string): number {
  if (!scope) {
    const reported = reportCountsByContext.get(context) ?? 0
    reportCountsByContext.set(context, reported + 1)
    return reported
  }
  let counts = reportCountsByScope.get(scope)
  if (!counts) {
    counts = new Map()
    reportCountsByScope.set(scope, counts)
  }
  const reported = counts.get(context) ?? 0
  counts.set(context, reported + 1)
  return reported
}

/**
 * Run one step of a write-completion callback so a synchronous throw cannot
 * escape into xterm's WriteBuffer. Steps are guarded individually so an
 * earlier step's failure (e.g. a WebGL refresh during viewport settle) cannot
 * starve a later step (e.g. the replay-guard release). A scope makes the
 * failure quarantine local; an omitted scope remains report-only.
 */
export function runGuardedWriteCompletionStep(
  context: string,
  step: () => void,
  scope?: object
): void {
  const failureState = scope ? getScopedFailureState(scope, context) : undefined
  if (failureState?.quarantined) {
    return
  }
  try {
    step()
    if (failureState) {
      failureState.failures = 0
    }
  } catch (error: unknown) {
    if (failureState) {
      failureState.failures += 1
      if (failureState.failures >= MAX_REPORTS_PER_CONTEXT) {
        failureState.quarantined = true
      }
    }
    const reported = incrementReportCount(scope, context)
    if (reported >= MAX_REPORTS_PER_CONTEXT) {
      return
    }
    console.error(`[terminal] write-completion step "${context}" threw`, error)
    recordRendererCrashBreadcrumb('terminal_write_completion_error', {
      context,
      errorName: error instanceof Error ? error.name : typeof error,
      errorMessage: error instanceof Error ? error.message : String(error)
    })
  }
}

export function _resetWriteCompletionReportsForTests(): void {
  reportCountsByContext = new Map()
  reportCountsByScope = new WeakMap()
  failureStatesByScope = new WeakMap()
}
