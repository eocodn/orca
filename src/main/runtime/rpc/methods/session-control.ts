import type {
  RuntimeSessionFlushResult,
  RuntimeSessionSnapshot
} from '../../../../shared/runtime-types'
import { defineMethod, type RpcAnyMethod } from '../core'

export const SESSION_CONTROL_METHODS: RpcAnyMethod[] = [
  defineMethod({
    name: 'session.snapshot',
    params: null,
    handler: async (_params, { runtime }) => ({
      snapshot: (await runtime.getSessionSnapshot()) as RuntimeSessionSnapshot
    })
  }),
  defineMethod({
    name: 'session.flush',
    params: null,
    handler: async (_params, { runtime }) => ({
      flush: (await runtime.flushSession()) as RuntimeSessionFlushResult
    })
  })
]
