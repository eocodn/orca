import { iterateTerminalInputChunks } from '../../shared/terminal-input'
import {
  AGENT_PROMPT_BRACKETED_PASTE_END,
  AGENT_PROMPT_SUBMIT,
  AGENT_PROMPT_SUBMIT_DELAY_MS
} from '../../shared/agent-prompt-injection'

type TerminalInputController = {
  write(ptyId: string, data: string): boolean
}

export type TerminalInputAction = {
  text?: string
  enter?: boolean
  interrupt?: boolean
}

export type TerminalInputWriteOptions = {
  beforeWrite?: (ptyId: string) => void | Promise<void>
  reserveWrite?: (ptyId: string) => void
  afterWrite?: (ptyId: string) => void | Promise<void>
  suffixFailureError?: string
}

export class RuntimeTerminalInputCommands {
  constructor(private readonly getController: () => TerminalInputController | null) {}

  async writeTerminalAction(
    ptyId: string,
    action: TerminalInputAction,
    payload: string,
    options: TerminalInputWriteOptions = {}
  ): Promise<void> {
    const hasText = typeof action.text === 'string' && action.text.length > 0
    const hasSuffix = action.enter || action.interrupt
    if (hasText) {
      await this.writeTerminalInputChunks(ptyId, action.text!, options)
    }
    if (hasSuffix) {
      const suffix = (action.enter ? '\r' : '') + (action.interrupt ? '\x03' : '')
      if (hasText) {
        await new Promise((resolve) => setTimeout(resolve, 500))
      }
      try {
        await options.beforeWrite?.(ptyId)
        options.reserveWrite?.(ptyId)
      } catch (error) {
        if (options.suffixFailureError) {
          throw new Error(options.suffixFailureError)
        }
        throw error
      }
      const wrote = this.getController()?.write(ptyId, suffix) ?? false
      if (!wrote) {
        throw new Error(options.suffixFailureError ?? 'terminal_not_writable')
      }
      await options.afterWrite?.(ptyId)
      return
    }
    if (hasText) {
      return
    }

    await options.beforeWrite?.(ptyId)
    options.reserveWrite?.(ptyId)
    const wrote = this.getController()?.write(ptyId, payload) ?? false
    if (!wrote) {
      throw new Error('terminal_not_writable')
    }
    await options.afterWrite?.(ptyId)
  }

  async writeTerminalInputChunks(
    ptyId: string,
    text: string,
    options: Pick<TerminalInputWriteOptions, 'beforeWrite' | 'reserveWrite' | 'afterWrite'> = {}
  ): Promise<void> {
    const chunks = iterateTerminalInputChunks(text)
    let chunk = chunks.next()
    while (!chunk.done) {
      await options.beforeWrite?.(ptyId)
      options.reserveWrite?.(ptyId)
      const wrote = this.getController()?.write(ptyId, chunk.value) ?? false
      if (!wrote) {
        throw new Error('terminal_not_writable')
      }
      await options.afterWrite?.(ptyId)
      chunk = chunks.next()
      if (!chunk.done) {
        await new Promise((resolve) => setTimeout(resolve, 0))
      }
    }
  }

  async writeTerminalAgentPrompt(
    ptyId: string,
    pastePayload: string,
    options: Pick<TerminalInputWriteOptions, 'beforeWrite' | 'suffixFailureError'> = {}
  ): Promise<void> {
    let wrotePasteBytes = false
    let completedPaste = false
    try {
      const chunks = iterateTerminalInputChunks(pastePayload)
      let chunk = chunks.next()
      while (!chunk.done) {
        await options.beforeWrite?.(ptyId)
        const wrote = this.getController()?.write(ptyId, chunk.value) ?? false
        if (!wrote) {
          throw new Error('terminal_not_writable')
        }
        wrotePasteBytes = true
        chunk = chunks.next()
        if (!chunk.done) {
          await new Promise((resolve) => setTimeout(resolve, 0))
        }
      }
      completedPaste = true
    } catch (error) {
      if (wrotePasteBytes && !completedPaste) {
        this.getController()?.write(ptyId, AGENT_PROMPT_BRACKETED_PASTE_END)
      }
      throw error
    }

    await new Promise((resolve) => setTimeout(resolve, AGENT_PROMPT_SUBMIT_DELAY_MS))
    try {
      await options.beforeWrite?.(ptyId)
    } catch (error) {
      if (options.suffixFailureError) {
        throw new Error(options.suffixFailureError)
      }
      throw error
    }
    const suffixWrote = this.getController()?.write(ptyId, AGENT_PROMPT_SUBMIT) ?? false
    if (!suffixWrote) {
      throw new Error(options.suffixFailureError ?? 'terminal_not_writable')
    }
  }
}
