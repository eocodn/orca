import type { CommandHandler } from '../dispatch'
import { ORCHESTRATION_HANDLERS_1 } from './orchestration-handler-1'
import { ORCHESTRATION_HANDLERS_2 } from './orchestration-handler-2'
import { ORCHESTRATION_HANDLERS_3 } from './orchestration-handler-3'
import { ORCHESTRATION_HANDLERS_4 } from './orchestration-handler-4'
import { ORCHESTRATION_HANDLERS_5 } from './orchestration-handler-5'
import { ORCHESTRATION_HANDLERS_6 } from './orchestration-handler-6'

export const ORCHESTRATION_HANDLERS: Record<string, CommandHandler> = {
  ...ORCHESTRATION_HANDLERS_1,
  ...ORCHESTRATION_HANDLERS_2,
  ...ORCHESTRATION_HANDLERS_3,
  ...ORCHESTRATION_HANDLERS_4,
  ...ORCHESTRATION_HANDLERS_5,
  ...ORCHESTRATION_HANDLERS_6
}
