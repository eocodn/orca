import type { CommandHandler } from './dispatch'
import { BROWSER_HANDLER_GROUPS } from './browser-handler-groups'

export type HandlerGroup = {
  name: string
  // Why: eager string keys let dispatch build (and duplicate-check) the whole
  // command table without loading any group's transitive module graph.
  keys: readonly string[]
  load: () => Promise<Record<string, CommandHandler>>
}

// Why: `keys` mirrors each group's exported record and is verified against the
// real exports by handler-group-manifest.test.ts, so drift fails CI, not dispatch.
export const HANDLER_GROUPS: readonly HandlerGroup[] = [
  {
    name: 'core',
    keys: ['claude-teams', 'open', 'serve', 'status'],
    load: async () => (await import('./handlers/core.js')).CORE_HANDLERS
  },
  {
    name: 'account',
    keys: ['account add', 'account list'],
    load: async () => (await import('./handlers/account.js')).ACCOUNT_HANDLERS
  },
  {
    name: 'project',
    keys: [
      'project list',
      'project setups',
      'project setup-existing-folder',
      'project setup-clone',
      'project setup-create',
      'project setup-update',
      'project setup-delete'
    ],
    load: async () => (await import('./handlers/project.js')).PROJECT_HANDLERS
  },
  {
    name: 'repo',
    keys: ['repo list', 'repo add', 'repo show', 'repo set-base-ref', 'repo search-refs'],
    load: async () => (await import('./handlers/repo.js')).REPO_HANDLERS
  },
  {
    name: 'folder-workspace',
    keys: [
      'folder-workspace list',
      'folder-workspace add',
      'folder-workspace inspect',
      'folder-workspace remove'
    ],
    load: async () => (await import('./handlers/folder-workspace.js')).FOLDER_WORKSPACE_HANDLERS
  },
  {
    name: 'session',
    keys: ['session snapshot', 'session flush'],
    load: async () => (await import('./handlers/session.js')).SESSION_HANDLERS
  },
  {
    name: 'worktree',
    keys: [
      'worktree ps',
      'worktree list',
      'worktree show',
      'worktree current',
      'worktree create',
      'worktree set',
      'worktree rm'
    ],
    load: async () => (await import('./handlers/worktree.js')).WORKTREE_HANDLERS
  },
  {
    name: 'file',
    keys: ['file open', 'file diff', 'file open-changed'],
    load: async () => (await import('./handlers/file.js')).FILE_HANDLERS
  },
  {
    name: 'terminal',
    keys: [
      'terminal list',
      'terminal show',
      'terminal inspect',
      'terminal resize',
      'terminal read',
      'terminal send',
      'terminal wait',
      'terminal stop',
      'terminal rename',
      'terminal create',
      'terminal switch',
      'terminal close',
      'terminal split'
    ],
    load: async () => (await import('./handlers/terminal.js')).TERMINAL_HANDLERS
  },
  ...BROWSER_HANDLER_GROUPS,
  {
    name: 'agent-hooks',
    keys: ['agent hooks status', 'agent hooks off', 'agent hooks on'],
    load: async () => (await import('./handlers/agent-hooks.js')).AGENT_HOOK_HANDLERS
  },
  {
    name: 'diagnostics',
    keys: ['diagnostics memory'],
    load: async () => (await import('./handlers/diagnostics.js')).DIAGNOSTICS_HANDLERS
  },
  {
    name: 'introspection',
    keys: ['agent-context'],
    load: async () => (await import('./handlers/introspection.js')).INTROSPECTION_HANDLERS
  },
  {
    name: 'environment',
    keys: ['environment add', 'environment list', 'environment show', 'environment rm'],
    load: async () => (await import('./handlers/environment.js')).ENVIRONMENT_HANDLERS
  },
  {
    name: 'linear',
    keys: [
      'linear save-issue',
      'linear list-issues',
      'linear relation add',
      'linear relation remove',
      'linear issue',
      'linear search',
      'linear team list',
      'linear team members',
      'linear team states',
      'linear team labels',
      'linear project list',
      'linear list',
      'linear status set',
      'linear assignee set',
      'linear assignee clear',
      'linear priority set',
      'linear priority clear',
      'linear estimate set',
      'linear estimate clear',
      'linear due-date set',
      'linear due-date clear',
      'linear label add',
      'linear label remove',
      'linear label set',
      'linear comment add',
      'linear attach',
      'linear create'
    ],
    load: async () => (await import('./handlers/linear.js')).LINEAR_HANDLERS
  },
  {
    name: 'vm',
    keys: ['vm recipe doctor'],
    load: async () => (await import('./handlers/vm.js')).VM_HANDLERS
  }
]
