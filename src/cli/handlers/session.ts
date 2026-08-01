import type { RuntimeSessionFlushResult, RuntimeSessionSnapshot } from '../../shared/runtime-types'
import type { CommandHandler } from '../dispatch'
import { formatSessionFlush, formatSessionSnapshot, printResult } from '../format'

export const SESSION_HANDLERS: Record<string, CommandHandler> = {
  'session snapshot': async ({ client, json }) => {
    const result = await client.call<{ snapshot: RuntimeSessionSnapshot }>('session.snapshot')
    printResult(result, json, formatSessionSnapshot)
  },
  'session flush': async ({ client, json }) => {
    const result = await client.call<{ flush: RuntimeSessionFlushResult }>('session.flush')
    printResult(result, json, formatSessionFlush)
  }
}
