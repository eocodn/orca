import type { CommandSpec } from '../args'
import { GLOBAL_FLAGS } from '../args'

export const FOLDER_WORKSPACE_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['folder-workspace', 'list'],
    summary: 'List folder workspaces on the selected runtime',
    usage: 'orca folder-workspace list [--json]',
    allowedFlags: [...GLOBAL_FLAGS]
  },
  {
    path: ['folder-workspace', 'add'],
    summary: 'Register a folder workspace and verify authoritative state',
    usage:
      'orca folder-workspace add --project-group <id> --path <path> --operation-id <id> [--name <name>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'project-group', 'path', 'operation-id', 'name'],
    notes: [
      'The project group must already exist and be folder-backed.',
      '--operation-id makes retries idempotent across process restarts.'
    ]
  },
  {
    path: ['folder-workspace', 'inspect'],
    aliases: [['folder-workspace', 'show']],
    summary: 'Inspect one host-qualified folder workspace',
    usage: 'orca folder-workspace inspect --folder-workspace <id> [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'folder-workspace']
  },
  {
    path: ['folder-workspace', 'remove'],
    aliases: [
      ['folder-workspace', 'rm'],
      ['folder-workspace', 'delete']
    ],
    destructive: true,
    summary: 'Remove a folder workspace and verify authoritative absence',
    usage: 'orca folder-workspace remove --folder-workspace <id> [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'folder-workspace'],
    notes: [
      'Removal is idempotent by folder-workspace identity; an already absent target is success.'
    ]
  }
]
