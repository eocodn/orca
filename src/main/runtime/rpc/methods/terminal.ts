import type { RpcAnyMethod } from '../core'
import { TERMINAL_CORE_METHODS } from './terminal-core-methods'
import { TERMINAL_MULTIPLEX_METHODS } from './terminal-multiplex-method'
import { TERMINAL_SUBSCRIBE_METHODS } from './terminal-subscribe-method'
import { TERMINAL_TAIL_METHODS } from './terminal-tail-methods'

export const TERMINAL_METHODS: RpcAnyMethod[] = [
  ...TERMINAL_CORE_METHODS,
  ...TERMINAL_MULTIPLEX_METHODS,
  ...TERMINAL_SUBSCRIBE_METHODS,
  ...TERMINAL_TAIL_METHODS
]
