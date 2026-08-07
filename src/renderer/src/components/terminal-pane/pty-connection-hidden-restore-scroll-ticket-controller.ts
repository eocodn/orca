export type HiddenRestoreScrollTicket = object

type ScrollTicketState = {
  ticket: HiddenRestoreScrollTicket
  ptyId: string | null
  generation: number
  started: boolean
}

export function createPtyConnectionHiddenRestoreScrollTicketController() {
  let current: ScrollTicketState | null = null

  return {
    hasCurrent(): boolean {
      return current !== null
    },
    begin(ptyId: string | null, generation: number): HiddenRestoreScrollTicket {
      const ticket = {}
      current = { ticket, ptyId, generation, started: false }
      return ticket
    },
    isCurrent(
      ticket: HiddenRestoreScrollTicket,
      ptyId: string | null,
      generation: number
    ): boolean {
      return (
        current !== null &&
        current.ticket === ticket &&
        current.ptyId === ptyId &&
        current.generation === generation
      )
    },
    markStarted(ticket: HiddenRestoreScrollTicket): boolean {
      if (current?.ticket !== ticket) {
        return false
      }
      current.started = true
      return true
    },
    handoffGeneration(expectedPtyId: string, generation: number): boolean {
      if (current?.ptyId !== expectedPtyId) {
        return false
      }
      current.generation = generation
      return true
    },
    invalidateCurrent(): { started: boolean } | null {
      if (current === null) {
        return null
      }
      const invalidated = { started: current.started }
      current = null
      return invalidated
    },
    clearIf(ticket: HiddenRestoreScrollTicket): void {
      if (current?.ticket === ticket) {
        current = null
      }
    }
  }
}
