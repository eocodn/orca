import type { SshChannelMultiplexer } from '../ssh/ssh-channel-multiplexer'
import type { PtyProcessInspection } from './pty-process-inspection'
import { mapSshPtyProcessList } from './ssh-agent-session-process-list'
import type { PtyProcessInfo } from './types'

export function relayTimeoutOptions(
  deadlineMs: number | undefined
): { timeoutMs: number } | undefined {
  return deadlineMs === undefined ? undefined : { timeoutMs: Math.max(1, deadlineMs - Date.now()) }
}

export async function requestSshPtyResizeIfCurrent(
  mux: SshChannelMultiplexer,
  id: string,
  expectedIncarnationId: string,
  cols: number,
  rows: number
): Promise<boolean> {
  const response = (await mux.request(
    'pty.resizeIfCurrent',
    { id, expectedIncarnationId, cols, rows },
    { timeoutMs: 1_000 }
  )) as { applied?: unknown }
  if (typeof response?.applied !== 'boolean') {
    throw new Error('Malformed pty.resizeIfCurrent response')
  }
  return response.applied
}

export async function requestSshPtySignal(
  mux: SshChannelMultiplexer,
  id: string,
  signal: string
): Promise<void> {
  await mux.request('pty.sendSignal', { id, signal })
}

export async function requestSshPtyString(
  mux: SshChannelMultiplexer,
  method: 'pty.getCwd' | 'pty.getInitialCwd',
  id: string
): Promise<string> {
  return (await mux.request(method, { id })) as string
}

export async function requestSshPtyClearBuffer(
  mux: SshChannelMultiplexer,
  id: string
): Promise<void> {
  await mux.request('pty.clearBuffer', { id })
}

export async function requestSshPtyCloseStartupAuthority(
  mux: SshChannelMultiplexer,
  id: string
): Promise<number> {
  const result = (await mux.request('pty.closeStartupQueryAuthority', { id })) as {
    appliedSeq?: number
  }
  return result.appliedSeq ?? 0
}

export async function requestSshPtyShutdown(
  mux: SshChannelMultiplexer,
  id: string,
  opts: { immediate?: boolean; keepHistory?: boolean; deadlineMs?: number }
): Promise<void> {
  await mux.request(
    'pty.shutdown',
    {
      id,
      immediate: opts.immediate ?? false,
      keepHistory: opts.keepHistory ?? false
    },
    relayTimeoutOptions(opts.deadlineMs)
  )
}

export async function requestSshPtyProcessInspection(
  mux: SshChannelMultiplexer,
  id: string
): Promise<PtyProcessInspection> {
  return (await mux.request('pty.inspectProcess', { id })) as PtyProcessInspection
}

export async function requestSshPtyHasChildProcesses(
  mux: SshChannelMultiplexer,
  id: string
): Promise<boolean> {
  return (await mux.request('pty.hasChildProcesses', { id })) as boolean
}

export async function requestSshPtyForegroundProcess(
  mux: SshChannelMultiplexer,
  id: string
): Promise<string | null> {
  return (await mux.request('pty.getForegroundProcess', { id })) as string | null
}

export async function requestSshPtySerialize(
  mux: SshChannelMultiplexer,
  ids: string[]
): Promise<string> {
  return (await mux.request('pty.serialize', { ids })) as string
}

export async function requestSshPtyRevive(
  mux: SshChannelMultiplexer,
  state: string
): Promise<void> {
  await mux.request('pty.revive', { state })
}

export async function requestSshPtyDefaultShell(mux: SshChannelMultiplexer): Promise<string> {
  return (await mux.request('pty.getDefaultShell')) as string
}

export async function requestSshPtyProfiles(
  mux: SshChannelMultiplexer
): Promise<{ name: string; path: string }[]> {
  return (await mux.request('pty.getProfiles')) as { name: string; path: string }[]
}

export async function requestSshPtyProcessList(
  mux: SshChannelMultiplexer,
  deadlineMs: number | undefined,
  toAppPtyId: (id: string) => string
): Promise<PtyProcessInfo[]> {
  const result = await mux.request('pty.listProcesses', undefined, relayTimeoutOptions(deadlineMs))
  return mapSshPtyProcessList(result as PtyProcessInfo[], toAppPtyId)
}
