import { shouldDropQuarantinedTerminalInput } from './terminal-input-quarantine'

type TerminalInputDeliveryOptions = {
  tabId?: string
  sendInput: (data: string) => boolean
  sendInputImmediate?: (data: string) => boolean
  sendInputAccepted?: (data: string) => Promise<boolean>
}

export function createTerminalInputDelivery(options: TerminalInputDeliveryOptions): {
  sendInput: (data: string) => boolean
  sendInputImmediate: (data: string) => boolean
  sendInputAccepted?: (data: string) => Promise<boolean>
} {
  const shouldDrop = (data: string): boolean =>
    options.tabId !== undefined && shouldDropQuarantinedTerminalInput(options.tabId, data)

  const delivery = {
    sendInput(data: string): boolean {
      if (shouldDrop(data)) return true
      return options.sendInput(data)
    },
    // Device replies must reach the endpoint while the interrupted line is quarantined.
    sendInputImmediate(data: string): boolean {
      return (options.sendInputImmediate ?? options.sendInput)(data)
    }
  }

  if (options.sendInputAccepted !== undefined) {
    return {
      ...delivery,
      sendInputAccepted(data: string): Promise<boolean> {
        if (shouldDrop(data)) return Promise.resolve(true)
        return options.sendInputAccepted!(data)
      }
    }
  }

  return delivery
}
