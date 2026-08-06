export const pendingSpawnByPaneKey = new Map<string, Promise<string | null>>()
export const SSH_SESSION_EXPIRED_ERROR = 'SSH_SESSION_EXPIRED'
// Why: relay requests expire at 30s; leave one second for their fallback before re-arming locally.
export const DIRECT_SSH_PANE_RETRY_SETTLEMENT_TIMEOUT_MS = 31_000
export const REMOTE_PTY_ID_PREFIX = 'remote:'
export const PTY_CONNECT_DIAG_LIMIT = 200
export const SSH_SHELL_READY_STARTUP_FALLBACK_MS = 1500
export const MANUAL_AGENT_COMMAND_MAX_CHARS = 4096
export const STARTUP_DRAFT_PASTE_QUIET_MS = 1500
// Why: the notice deliberately omits the rejected path — saved cwds can
// contain private repo/user names; the terminal itself shows where it opened.
export const STARTUP_CWD_FALLBACK_NOTICE =
  '\r\n[Orca opened this terminal at the workspace root because its saved start folder no longer exists.]\r\n'
export const STARTUP_DRAFT_PASTE_TIMEOUT_MS = 8000
export const HIDDEN_OUTPUT_RESTORE_PENDING_CHARS = 512 * 1024
export const HIDDEN_OUTPUT_RESTORE_DEFERRED_RETRY_MS = 50
export const HIDDEN_OUTPUT_RESTORE_DEFERRED_RETRY_MAX = 3
export const HIDDEN_OUTPUT_RESTORE_FOREGROUND_TIMEOUT_MS = 750
// Why (rc.7.perf DSR-timeout feedback loop): under a foreground flood the
// restore pipeline is its own bottleneck — each synchronous snapshot replay
// starves ACK processing, main pins at the in-flight cap, drops at the
// pending cap, and every drop marker re-armed another restore until the
// flood ended. Backpressure evidence opens this suppression window: drop
// markers inside it must not re-arm restores; live bytes write through and
// ONE deferred repaint (when the window closes) heals the visual gap.
export const HIDDEN_OUTPUT_RESTORE_FLOOD_SUPPRESS_MS = 2000
// Backstop for the same loop: a single in-flight restore task may re-iterate
// (fresh-snapshot marks, unmappable slices) only this many times before it
// abandons and lets live bytes flow.
export const HIDDEN_OUTPUT_RESTORE_MAX_LOOP_ITERATIONS = 3
export const TERMINAL_RENDERER_RISK_SCAN_TAIL_CHARS = 256
export const SYNCHRONIZED_OUTPUT_START_SEQUENCE = '\x1b[?2026h'
export const SYNCHRONIZED_OUTPUT_END_SEQUENCE = '\x1b[?2026l'
export const SYNCHRONIZED_OUTPUT_MARKER_TAIL_CHARS = SYNCHRONIZED_OUTPUT_START_SEQUENCE.length - 1
export const CURSOR_SHOW_SEQUENCE = '\x1b[?25h'
export const CURSOR_HIDE_SEQUENCE = '\x1b[?25l'
export const TERMINAL_FOCUS_IN_SEQUENCE = '\x1b[I'
export const TERMINAL_FOCUS_OUT_SEQUENCE = '\x1b[O'
export const FOCUS_REPORTING_DISABLE_SEQUENCE = '\x1b[?1004l'
export const REATTACH_IDLE_AGENT_CURSOR_RESET_DELAY_MS = 250
export const SHIFT_ENTER_RECONFIRM_IDLE_MS = 350
export const FOREGROUND_THROUGHPUT_IMMEDIATE_CHARS = 2048
export const FOREGROUND_INTERACTIVE_REDRAW_CHARS = 128 * 1024
export const FOREGROUND_INTERACTIVE_REDRAW_WINDOW_MS = 150
// Why: a submit repaint can take longer than one keystroke echo to fully
// arrive, so a synchronized frame that *began* this close to a keystroke stays
// latency-sensitive even when ConPTY splits its end marker past the redraw
// window — the keystroke is the "user is here, paint now" signal, not the
// late closing chunk.
export const FOREGROUND_SYNCHRONIZED_FRAME_INTERACTIVE_WINDOW_MS = 400
// Why: OpenTUI can emit many tiny redraws that each look interactive but
// collectively starve timers unless foreground writes have a rolling budget.
export const FOREGROUND_IMMEDIATE_BUDGET_CHARS = 128 * 1024
export const FOREGROUND_BUDGET_WINDOW_MS = 500
export const INACTIVE_FOREGROUND_IMMEDIATE_BUDGET_CHARS = 32 * 1024
export const FOREGROUND_GRID_DRIFT_CHECK_MIN_MS = 250
// Why: this is only shown if hidden renderer output was skipped and main-owned
// terminal state is unavailable, so the user has an explicit loss signal.
export const HIDDEN_OUTPUT_RESTORE_UNAVAILABLE_WARNING =
  '\x18\x1b[0m\r\n[Orca skipped hidden terminal output because main recovery was unavailable.]\r\n'
