import type { CommandSpec } from '../args'
import { GLOBAL_FLAGS } from '../args'

export const SESSION_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['session', 'snapshot'],
    summary: 'Read authoritative session state and revision',
    usage: 'orca session snapshot [--json]',
    allowedFlags: [...GLOBAL_FLAGS]
  },
  {
    path: ['session', 'flush'],
    summary: 'Durably flush session state and read it back',
    usage: 'orca session flush [--json]',
    allowedFlags: [...GLOBAL_FLAGS],
    notes: ['Success requires the Host persistence barrier and authoritative read-back.']
  }
]
