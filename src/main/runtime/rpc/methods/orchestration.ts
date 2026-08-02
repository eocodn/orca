import type { RpcMethod } from '../core'
import { ORCHESTRATION_GATE_METHODS } from './orchestration-gates'
import { ORCHESTRATION_RUN_METHODS } from './orchestration-runs'
import { ORCHESTRATION_WORKER_METHODS } from './orchestration-worker-methods'
import { ORCHESTRATION_FEDERATION_METHODS } from './orchestration-federation-methods'
import { ORCHESTRATION_SEND_METHODS } from './orchestration-SEND-method'
import { ORCHESTRATION_CHECK_METHODS } from './orchestration-CHECK-method'
import { ORCHESTRATION_REPLY_METHODS } from './orchestration-REPLY-method'
import { ORCHESTRATION_INBOX_METHODS } from './orchestration-INBOX-method'
import { ORCHESTRATION_TASK_CREATE_METHODS } from './orchestration-TASK_CREATE-method'
import { ORCHESTRATION_TASK_LIST_METHODS } from './orchestration-TASK_LIST-method'
import { ORCHESTRATION_TASK_UPDATE_METHODS } from './orchestration-TASK_UPDATE-method'
import { ORCHESTRATION_DISPATCH_METHODS } from './orchestration-DISPATCH-method'
import { ORCHESTRATION_DISPATCH_SHOW_METHODS } from './orchestration-DISPATCH_SHOW-method'
import { ORCHESTRATION_ASK_METHODS } from './orchestration-ASK-method'
import { ORCHESTRATION_RESET_METHODS } from './orchestration-RESET-method'

export const ORCHESTRATION_METHODS: RpcMethod[] = [
  ...ORCHESTRATION_RUN_METHODS,
  ...ORCHESTRATION_WORKER_METHODS,
  ...ORCHESTRATION_FEDERATION_METHODS,
  ...ORCHESTRATION_SEND_METHODS,
  ...ORCHESTRATION_CHECK_METHODS,
  ...ORCHESTRATION_REPLY_METHODS,
  ...ORCHESTRATION_INBOX_METHODS,
  ...ORCHESTRATION_TASK_CREATE_METHODS,
  ...ORCHESTRATION_TASK_LIST_METHODS,
  ...ORCHESTRATION_TASK_UPDATE_METHODS,
  ...ORCHESTRATION_DISPATCH_METHODS,
  ...ORCHESTRATION_DISPATCH_SHOW_METHODS,
  ...ORCHESTRATION_ASK_METHODS,
  ...ORCHESTRATION_GATE_METHODS,
  ...ORCHESTRATION_RESET_METHODS
]
