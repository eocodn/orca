import type {
  RuntimeTerminalClose,
  RuntimeTerminalCreate,
  RuntimeTerminalFocus,
  RuntimeTerminalListResult,
  RuntimeTerminalInspect,
  RuntimeTerminalRead,
  RuntimeTerminalRename,
  RuntimeTerminalSend,
  RuntimeTerminalShow,
  RuntimeTerminalResize,
  RuntimeTerminalSplit,
  RuntimeTerminalWait
} from '../../shared/runtime-types'
import type { CommandHandler } from '../dispatch'
import { shouldUseRendererBackedInteractiveTerminal } from '../codex-command-classification'
import {
  formatTerminalClose,
  formatTerminalCreate,
  formatTerminalFocus,
  formatTerminalList,
  formatTerminalInspect,
  formatTerminalRead,
  formatTerminalRename,
  formatTerminalSend,
  formatTerminalShow,
  formatTerminalResize,
  formatTerminalSplit,
  formatTerminalWait,
  printResult
} from '../format'
import {
  getOptionalPositiveIntegerFlag,
  getOptionalStringFlag,
  getRequiredStringFlag
} from '../flags'
import { RuntimeClientError } from '../runtime-client'
import {
  TERMINAL_MAX_COLS,
  TERMINAL_MAX_ROWS,
  TERMINAL_MIN_COLS,
  TERMINAL_MIN_ROWS
} from '../../shared/terminal-dimensions'
import {
  getBrowserWorktreeSelector,
  getOptionalWorktreeSelector,
  getRequiredWorktreeSelector,
  getTerminalHandle
} from '../selectors'

// Why: terminal wait legitimately needs to outlive the CLI's default RPC
// timeout. Even without an explicit server timeout, the client must allow
// long waits instead of failing at the generic 15s transport cap.
const DEFAULT_TERMINAL_WAIT_RPC_TIMEOUT_MS = 5 * 60 * 1000

function getRequiredTerminalDimensionFlag(
  flags: Map<string, string | boolean>,
  name: 'cols' | 'rows'
): number {
  const raw = getRequiredStringFlag(flags, name)
  const min = name === 'cols' ? TERMINAL_MIN_COLS : TERMINAL_MIN_ROWS
  const max = name === 'cols' ? TERMINAL_MAX_COLS : TERMINAL_MAX_ROWS
  if (!/^[1-9]\d*$/.test(raw)) {
    throw new RuntimeClientError(
      'invalid_argument',
      `--${name} must be a canonical decimal integer from ${min} to ${max}`
    )
  }
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new RuntimeClientError(
      'invalid_argument',
      `--${name} must be a canonical decimal integer from ${min} to ${max}`
    )
  }
  return value
}

const terminalFocusHandler: CommandHandler = async ({ flags, client, cwd, json }) => {
  const result = await client.call<{ focus: RuntimeTerminalFocus }>('terminal.focus', {
    terminal: await getTerminalHandle(flags, cwd, client),
    navigation: 'host'
  })
  printResult(result, json, formatTerminalFocus)
}

export const TERMINAL_HANDLERS: Record<string, CommandHandler> = {
  'terminal list': async ({ flags, client, cwd, json }) => {
    const result = await client.call<RuntimeTerminalListResult>('terminal.list', {
      worktree: await getOptionalWorktreeSelector(flags, 'worktree', cwd, client),
      limit: getOptionalPositiveIntegerFlag(flags, 'limit')
    })
    printResult(result, json, formatTerminalList)
  },
  'terminal show': async ({ flags, client, cwd, json }) => {
    const result = await client.call<{ terminal: RuntimeTerminalShow }>('terminal.show', {
      terminal: await getTerminalHandle(flags, cwd, client)
    })
    printResult(result, json, formatTerminalShow)
  },
  'terminal inspect': async ({ flags, client, cwd, json }) => {
    const result = await client.call<{ terminal: RuntimeTerminalInspect }>('terminal.inspect', {
      terminal: await getTerminalHandle(flags, cwd, client)
    })
    printResult(result, json, formatTerminalInspect)
  },
  'terminal resize': async ({ flags, client, cwd, json }) => {
    const result = await client.call<{ resize: RuntimeTerminalResize }>('terminal.resize', {
      terminal: await getTerminalHandle(flags, cwd, client),
      incarnation: getRequiredStringFlag(flags, 'incarnation'),
      cols: getRequiredTerminalDimensionFlag(flags, 'cols'),
      rows: getRequiredTerminalDimensionFlag(flags, 'rows')
    })
    printResult(result, json, formatTerminalResize)
  },
  'terminal read': async ({ flags, client, cwd, json }) => {
    const cursorFlag = getOptionalStringFlag(flags, 'cursor')
    const cursor =
      cursorFlag !== undefined && /^\d+$/.test(cursorFlag)
        ? Number.parseInt(cursorFlag, 10)
        : undefined
    if (cursorFlag !== undefined && cursor === undefined) {
      throw new RuntimeClientError('invalid_argument', '--cursor must be a non-negative integer')
    }
    const result = await client.call<{ terminal: RuntimeTerminalRead }>('terminal.read', {
      terminal: await getTerminalHandle(flags, cwd, client),
      ...(cursor !== undefined ? { cursor } : {}),
      limit: getOptionalPositiveIntegerFlag(flags, 'limit')
    })
    printResult(result, json, formatTerminalRead)
  },
  'terminal send': async ({ flags, client, cwd, json }) => {
    const result = await client.call<{ send: RuntimeTerminalSend }>('terminal.send', {
      terminal: await getTerminalHandle(flags, cwd, client),
      text: getOptionalStringFlag(flags, 'text'),
      enter: flags.get('enter') === true,
      interrupt: flags.get('interrupt') === true,
      client: { id: 'orca-cli', type: 'desktop' }
    })
    printResult(result, json, formatTerminalSend)
  },
  'terminal wait': async ({ flags, client, cwd, json }) => {
    const timeoutMs = getOptionalPositiveIntegerFlag(flags, 'timeout-ms')
    const result = await client.call<{ wait: RuntimeTerminalWait }>(
      'terminal.wait',
      {
        terminal: await getTerminalHandle(flags, cwd, client),
        for: getRequiredStringFlag(flags, 'for'),
        timeoutMs
      },
      {
        timeoutMs: timeoutMs ? timeoutMs + 5000 : DEFAULT_TERMINAL_WAIT_RPC_TIMEOUT_MS
      }
    )
    printResult(result, json, formatTerminalWait)
    if (result.result.wait.satisfied === false) {
      // Why: callers commonly chain `terminal wait && terminal send`; a
      // structured blocked result is still an unsatisfied wait condition.
      process.exitCode = 1
    }
  },
  'terminal stop': async ({ flags, client, cwd, json }) => {
    const result = await client.call<{ stopped: number }>('terminal.stop', {
      worktree: await getRequiredWorktreeSelector(flags, 'worktree', cwd, client)
    })
    printResult(result, json, (value) => `Stopped ${value.stopped} terminals.`)
  },
  'terminal rename': async ({ flags, client, cwd, json }) => {
    const result = await client.call<{ rename: RuntimeTerminalRename }>('terminal.rename', {
      terminal: await getTerminalHandle(flags, cwd, client),
      title: getOptionalStringFlag(flags, 'title') ?? null
    })
    printResult(result, json, formatTerminalRename)
  },
  'terminal create': async ({ flags, client, cwd, json }) => {
    if (client.isRemote && !flags.has('worktree')) {
      throw new RuntimeClientError(
        'invalid_argument',
        'Remote terminal create requires --worktree because the client cwd cannot identify a server worktree.'
      )
    }
    const command = getOptionalStringFlag(flags, 'command')
    const useRendererBackedInteractiveTerminal =
      !client.isRemote && shouldUseRendererBackedInteractiveTerminal(command)
    const focus = flags.get('focus') === true
    const result = await client.call<{ terminal: RuntimeTerminalCreate }>('terminal.create', {
      worktree: await getBrowserWorktreeSelector(flags, cwd, client),
      command,
      title: getOptionalStringFlag(flags, 'title'),
      // Why: interactive local agent TUIs need the renderer-backed terminal
      // path for browser-side features, but CLI creates must stay backgrounded
      // unless the caller explicitly asks for focus.
      focus,
      ...(focus ? { presentation: 'focused' } : {}),
      ...(useRendererBackedInteractiveTerminal ? { rendererBacked: true, activate: focus } : {})
    })
    printResult(result, json, formatTerminalCreate)
  },
  // `focus` resolves to this canonical path via CommandSpec.aliases before dispatch.
  'terminal switch': terminalFocusHandler,
  'terminal close': async ({ flags, client, cwd, json }) => {
    const method = flags.get('tab') === true ? 'terminal.closeTab' : 'terminal.close'
    const result = await client.call<{ close: RuntimeTerminalClose }>(method, {
      terminal: await getTerminalHandle(flags, cwd, client)
    })
    printResult(result, json, formatTerminalClose)
  },
  'terminal split': async ({ flags, client, cwd, json }) => {
    const directionFlag = getOptionalStringFlag(flags, 'direction')
    if (
      directionFlag !== undefined &&
      directionFlag !== 'horizontal' &&
      directionFlag !== 'vertical'
    ) {
      throw new RuntimeClientError('invalid_argument', '--direction must be horizontal or vertical')
    }
    const result = await client.call<{ split: RuntimeTerminalSplit }>('terminal.split', {
      terminal: await getTerminalHandle(flags, cwd, client),
      direction: directionFlag,
      command: getOptionalStringFlag(flags, 'command')
    })
    printResult(result, json, formatTerminalSplit)
  }
}
