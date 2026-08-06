import { useAppStore } from '@/store'
import { recognizeAgentProcessFromCommandLine } from '../../../../shared/agent-process-recognition'
import { isTuiAgent } from '../../../../shared/tui-agent-config'
import type { TuiAgent } from '../../../../shared/types'
import { MANUAL_AGENT_COMMAND_MAX_CHARS } from './pty-connection-runtime-state'

type CommandInferenceArgs = {
  cacheKey: string
}

type CommandInferenceCallbacks = {
  startAcceptedInferredCommand: (agent: TuiAgent) => void
  requestKnownDroidReconfirmation: () => void
  hasFreshPaneAgentSurface: () => boolean
}

export function createPtyConnectionCommandInference({ cacheKey }: CommandInferenceArgs) {
  let commandInferredPaneAgent: TuiAgent | null = null
  let pendingShellCommandLine = ''
  let pendingShellCommandCursor = 0
  let commandInferredPaneAgentGeneration = 0
  let shellCommandInferenceSuspendedUntilCommandEnd = false
  const callbacks: CommandInferenceCallbacks = {
    startAcceptedInferredCommand: () => {},
    requestKnownDroidReconfirmation: () => {},
    hasFreshPaneAgentSurface: () => false
  }
  const resetPendingShellCommandLine = (): void => {
    pendingShellCommandLine = ''
    pendingShellCommandCursor = 0
  }
  const rememberCommandInferredPaneAgent = (): void => {
    const commandLine = pendingShellCommandLine.trim()
    resetPendingShellCommandLine()
    const candidateAgent = commandLine
      ? (recognizeAgentProcessFromCommandLine(commandLine)?.agent ?? null)
      : null
    const state = useAppStore.getState()
    const registeredLaunchAgent = state.agentLaunchConfigByPaneKey[cacheKey]?.identity.agentType
    const nextAgent =
      state.paneForegroundAgentByPaneKey[cacheKey]?.agent || isTuiAgent(registeredLaunchAgent)
        ? null
        : candidateAgent
    commandInferredPaneAgent = nextAgent
    commandInferredPaneAgentGeneration += 1
    if (nextAgent) {
      callbacks.startAcceptedInferredCommand(nextAgent)
    }
  }
  const clearCommandInferredPaneAgent = (): void => {
    commandInferredPaneAgent = null
    resetPendingShellCommandLine()
    commandInferredPaneAgentGeneration += 1
  }
  const clearCommandInferredPaneAgentAfterPtySideEffects = (): void => {
    const generation = commandInferredPaneAgentGeneration
    resetPendingShellCommandLine()
    queueMicrotask(() => {
      setTimeout(() => {
        if (commandInferredPaneAgentGeneration === generation) {
          clearCommandInferredPaneAgent()
        }
      }, 0)
    })
  }
  const appendPendingShellCommandInput = (text: string): void => {
    const available = MANUAL_AGENT_COMMAND_MAX_CHARS - pendingShellCommandLine.length
    if (available <= 0) {
      shellCommandInferenceSuspendedUntilCommandEnd = true
      return
    }
    const inserted = text.slice(0, available)
    pendingShellCommandLine =
      pendingShellCommandLine.slice(0, pendingShellCommandCursor) +
      inserted +
      pendingShellCommandLine.slice(pendingShellCommandCursor)
    pendingShellCommandCursor += inserted.length
    if (inserted.length < text.length) {
      shellCommandInferenceSuspendedUntilCommandEnd = true
    }
  }
  const deletePendingShellCommandWord = (): void => {
    const beforeCursor = pendingShellCommandLine.slice(0, pendingShellCommandCursor)
    const afterCursor = pendingShellCommandLine.slice(pendingShellCommandCursor)
    const nextBeforeCursor = beforeCursor.replace(/[^\S\r\n]*\S+[^\S\r\n]*$/, '')
    pendingShellCommandLine = nextBeforeCursor + afterCursor
    pendingShellCommandCursor = nextBeforeCursor.length
  }
  const cancelSuspendedShellCommandInference = (): void => {
    if (!shellCommandInferenceSuspendedUntilCommandEnd) {
      return
    }
    shellCommandInferenceSuspendedUntilCommandEnd = false
    resetPendingShellCommandLine()
  }
  const deletePendingShellCommandCharacter = (): void => {
    if (pendingShellCommandCursor === 0) {
      return
    }
    pendingShellCommandLine =
      pendingShellCommandLine.slice(0, pendingShellCommandCursor - 1) +
      pendingShellCommandLine.slice(pendingShellCommandCursor)
    pendingShellCommandCursor -= 1
  }
  const deletePendingShellCommandCharacterAtCursor = (): void => {
    if (pendingShellCommandCursor >= pendingShellCommandLine.length) {
      return
    }
    pendingShellCommandLine =
      pendingShellCommandLine.slice(0, pendingShellCommandCursor) +
      pendingShellCommandLine.slice(pendingShellCommandCursor + 1)
  }
  const movePendingShellCommandCursor = (delta: number): void => {
    pendingShellCommandCursor = Math.min(
      pendingShellCommandLine.length,
      Math.max(0, pendingShellCommandCursor + delta)
    )
  }
  const consumeShellCommandCsiSequence = (data: string, index: number): number | null => {
    if (data.charCodeAt(index) !== 0x1b || data[index + 1] !== '[') {
      return null
    }
    let cursor = index + 2
    while (cursor < data.length && /[0-9;?]/.test(data[cursor]!)) {
      cursor += 1
    }
    const final = data[cursor]
    if (!final || !/[~A-Za-z]/.test(final)) {
      return null
    }
    const params = data.slice(index + 2, cursor)
    if (final === 'D' && params === '') {
      movePendingShellCommandCursor(-1)
    } else if (final === 'C' && params === '') {
      movePendingShellCommandCursor(1)
    } else if (final === 'H' || (final === '~' && params === '1')) {
      pendingShellCommandCursor = 0
    } else if (final === 'F' || (final === '~' && params === '4')) {
      pendingShellCommandCursor = pendingShellCommandLine.length
    } else if (final === '~' && params === '3') {
      deletePendingShellCommandCharacterAtCursor()
    } else if (final !== '~' || (params !== '200' && params !== '201')) {
      resetPendingShellCommandLine()
    }
    return cursor + 1
  }
  const observeAcceptedShellCommandInput = (data: string): void => {
    if (
      data.includes('\r') ||
      data.includes('\n') ||
      data.includes('\x03') ||
      data.includes('\x04')
    ) {
      callbacks.requestKnownDroidReconfirmation()
    }
    if (commandInferredPaneAgent) {
      return
    }
    if (callbacks.hasFreshPaneAgentSurface()) {
      resetPendingShellCommandLine()
      return
    }
    if (shellCommandInferenceSuspendedUntilCommandEnd) {
      if (data.includes('\x03') || data.includes('\x15')) {
        shellCommandInferenceSuspendedUntilCommandEnd = false
        resetPendingShellCommandLine()
      }
      if (data.includes('\r') || data.includes('\n')) {
        shellCommandInferenceSuspendedUntilCommandEnd = false
      }
      return
    }
    if (data.length > MANUAL_AGENT_COMMAND_MAX_CHARS) {
      resetPendingShellCommandLine()
      shellCommandInferenceSuspendedUntilCommandEnd = !data.includes('\r') && !data.includes('\n')
      return
    }
    for (let index = 0; index < data.length; index += 1) {
      const char = data[index]!
      if (char === '\r' || char === '\n') {
        shellCommandInferenceSuspendedUntilCommandEnd = false
        rememberCommandInferredPaneAgent()
        if (commandInferredPaneAgent) {
          return
        }
        continue
      }
      if (char === '\x7f' || char === '\b') {
        deletePendingShellCommandCharacter()
        continue
      }
      if (char === '\x17') {
        deletePendingShellCommandWord()
        continue
      }
      if (char === '\x03' || char === '\x15') {
        resetPendingShellCommandLine()
        continue
      }
      if (char === '\x1b') {
        const nextIndex = consumeShellCommandCsiSequence(data, index)
        if (nextIndex !== null) {
          index = nextIndex - 1
          continue
        }
        resetPendingShellCommandLine()
        continue
      }
      if (char < ' ') {
        resetPendingShellCommandLine()
        continue
      }
      appendPendingShellCommandInput(char)
      if (shellCommandInferenceSuspendedUntilCommandEnd) {
        return
      }
    }
  }

  return {
    getCommandInferredPaneAgent: (): TuiAgent | null => commandInferredPaneAgent,
    clearCommandInferredPaneAgent,
    clearCommandInferredPaneAgentAfterPtySideEffects,
    cancelSuspendedShellCommandInference,
    observeAcceptedShellCommandInput,
    requestKnownDroidReconfirmation: (): void => callbacks.requestKnownDroidReconfirmation(),
    setStartAcceptedInferredCommand: (handler: (agent: TuiAgent) => void): void => {
      callbacks.startAcceptedInferredCommand = handler
    },
    setRequestKnownDroidReconfirmation: (handler: () => void): void => {
      callbacks.requestKnownDroidReconfirmation = handler
    },
    setHasFreshPaneAgentSurface: (handler: () => boolean): void => {
      callbacks.hasFreshPaneAgentSurface = handler
    }
  }
}
