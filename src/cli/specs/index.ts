import type { CommandSpec } from '../args'
import { CORE_COMMAND_SPECS } from './core'
import { FILE_COMMAND_SPECS } from './file'
import { PROJECT_COMMAND_SPECS } from './project'
import { ENVIRONMENT_COMMAND_SPECS } from './environment'
import { DIAGNOSTICS_COMMAND_SPECS } from './diagnostics'
import { INTROSPECTION_COMMAND_SPECS } from './introspection'
import { LINEAR_COMMAND_SPECS } from './linear'
import { FOLDER_WORKSPACE_COMMAND_SPECS } from './folder-workspace'
import { SESSION_COMMAND_SPECS } from './session'

export const COMMAND_SPECS: CommandSpec[] = [
  ...CORE_COMMAND_SPECS,
  ...PROJECT_COMMAND_SPECS,
  ...FOLDER_WORKSPACE_COMMAND_SPECS,
  ...SESSION_COMMAND_SPECS,
  ...FILE_COMMAND_SPECS,
  ...DIAGNOSTICS_COMMAND_SPECS,
  ...INTROSPECTION_COMMAND_SPECS,
  ...ENVIRONMENT_COMMAND_SPECS,
  ...LINEAR_COMMAND_SPECS
]
