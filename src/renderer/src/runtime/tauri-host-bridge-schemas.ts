import { z } from 'zod'

const NonBlank = z.string().refine((value) => value.trim().length > 0)
export const RequestId = NonBlank
export const PathSchema = NonBlank
const SafeInteger = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)
const PositiveSafeInteger = SafeInteger.min(1)
const ExecutionTarget = z.enum(['windows-native', 'wsl2', 'ssh'])
const WorkspaceKind = z.enum(['folder', 'git-worktree'])

const WorkspaceLocationSchema = z.discriminatedUnion('target', [
  z
    .object({
      kind: WorkspaceKind,
      target: z.literal('windows-native'),
      identity: z.null(),
      path: PathSchema
    })
    .strict(),
  z
    .object({
      kind: WorkspaceKind,
      target: z.literal('wsl2'),
      identity: NonBlank,
      path: PathSchema
    })
    .strict(),
  z
    .object({
      kind: WorkspaceKind,
      target: z.literal('ssh'),
      identity: NonBlank,
      path: PathSchema
    })
    .strict()
])

const HostWorkspaceSchema = z
  .object({
    workspace_id: NonBlank,
    path: PathSchema,
    status: NonBlank,
    generation: SafeInteger,
    location: WorkspaceLocationSchema.nullable()
  })
  .strict()
  .superRefine((workspace, context) => {
    if (workspace.location && workspace.location.path !== workspace.path) {
      context.addIssue({
        code: 'custom',
        path: ['location', 'path'],
        message: 'workspace location path must equal workspace path'
      })
    }
  })

export const HostStatusSchema = z
  .object({
    service: z.literal('ade-host'),
    workspace_count: z.number().int().nonnegative(),
    ready_workspaces: z.number().int().nonnegative(),
    source: z.literal('sqlite-snapshot'),
    workspaces: z.array(HostWorkspaceSchema),
    hostProtocol: z
      .object({
        version: z.number().int().positive(),
        capabilities: z.array(z.string())
      })
      .strict()
  })
  .strict()
  .superRefine((status, context) => {
    if (status.workspace_count !== status.workspaces.length) {
      context.addIssue({
        code: 'custom',
        path: ['workspace_count'],
        message: 'workspace_count must equal authoritative workspace snapshot length'
      })
    }
    const readyWorkspaces = status.workspaces.filter(
      (workspace) => workspace.status === 'ready'
    ).length
    if (status.ready_workspaces !== readyWorkspaces) {
      context.addIssue({
        code: 'custom',
        path: ['ready_workspaces'],
        message: 'ready_workspaces must equal authoritative ready workspace count'
      })
    }
  })
export const HostStatusArgsSchema = z.object({ stateDb: PathSchema }).strict()

export const GitWorktreeSchema = z
  .object({
    path: z.string(),
    head: z.string(),
    branch: z.string().nullable(),
    is_bare: z.boolean(),
    locked: z.boolean(),
    lock_reason: z.string().nullable(),
    prunable: z.boolean(),
    prunable_reason: z.string().nullable(),
    is_main: z.boolean()
  })
  .strict()

export const GitResultSchema = z
  .object({
    request_id: RequestId,
    capability: z.literal('git'),
    operation: z.literal('worktree-list'),
    worktrees: z.array(GitWorktreeSchema)
  })
  .strict()

export const FileResultSchema = z
  .object({
    request_id: RequestId,
    capability: z.literal('file'),
    operation: z.enum(['read', 'write']),
    path: z.string(),
    bytes: z.array(z.number().int().min(0).max(255)),
    bytes_written: z.number().int().nonnegative(),
    changed: z.boolean()
  })
  .strict()

const TerminalOperationSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('start') }).strict(),
  z.object({ type: z.literal('snapshot') }).strict(),
  z
    .object({
      type: z.literal('output'),
      sequence: PositiveSafeInteger,
      data: z.string()
    })
    .strict(),
  z.object({ type: z.literal('exit'), code: z.number().int() }).strict(),
  z.object({ type: z.literal('fail'), reason: NonBlank }).strict(),
  z.object({ type: z.literal('close') }).strict()
])

export const TerminalRequestSchema = z
  .object({
    envelope: z
      .object({
        request_id: RequestId,
        capability: z.literal('terminal'),
        protocol_version: z.literal(1)
      })
      .strict(),
    terminal_id: NonBlank,
    expected_generation: SafeInteger,
    operation: TerminalOperationSchema
  })
  .strict()

export const TerminalResultSchema = z
  .object({
    request_id: RequestId,
    capability: z.literal('terminal'),
    protocol_version: z.literal(1),
    operation: z.enum(['start', 'snapshot', 'output', 'exit', 'fail', 'close']),
    terminal_id: NonBlank,
    generation: SafeInteger,
    status: z.enum(['created', 'running', 'exited', 'failed', 'closed']),
    exit_code: z.number().int().nullable(),
    failure_reason: z.string().nullable(),
    output_sequence: SafeInteger,
    tail: z.string()
  })
  .strict()

export const RegisterWorkspaceArgsSchema = z
  .object({
    stateDb: PathSchema,
    workspaceId: RequestId,
    path: PathSchema,
    requestId: RequestId,
    workspaceKind: WorkspaceKind.optional(),
    executionTarget: ExecutionTarget.optional(),
    remoteIdentity: z.string().min(1).optional()
  })
  .strict()

export const GitWorktreeListArgsSchema = z
  .object({
    requestId: RequestId,
    path: PathSchema,
    executionTarget: ExecutionTarget,
    remoteIdentity: z.string().min(1).optional()
  })
  .strict()

export const FileRequestArgsSchema = z
  .object({
    requestId: RequestId,
    operation: z.enum(['read', 'write']),
    path: PathSchema,
    bytes: z.array(z.number().int().min(0).max(255))
  })
  .strict()

export type TauriHostStatus = z.infer<typeof HostStatusSchema>
export type TauriGitWorktree = z.infer<typeof GitWorktreeSchema>
export type TauriGitWorktreeListArgs = z.input<typeof GitWorktreeListArgsSchema>
export type TauriGitWorktreeListResult = z.infer<typeof GitResultSchema>
export type TauriRegisterWorkspaceArgs = z.input<typeof RegisterWorkspaceArgsSchema>
export type TauriFileRequestArgs = Omit<z.input<typeof FileRequestArgsSchema>, 'bytes'> & {
  bytes?: readonly number[] | Uint8Array
}
export type TauriFileResult = z.infer<typeof FileResultSchema>
export type TauriTerminalRequest = z.input<typeof TerminalRequestSchema>
export type TauriTerminalResult = z.infer<typeof TerminalResultSchema>

export const PtyHostStatusSchema = z.discriminatedUnion('state', [
  z
    .object({
      service: z.literal('ade-host-pty'),
      state: z.literal('ready'),
      worker_id: NonBlank,
      worker_incarnation: PositiveSafeInteger,
      failure_reason: z.null()
    })
    .strict(),
  z
    .object({
      service: z.literal('ade-host-pty'),
      state: z.literal('unavailable'),
      worker_id: z.null(),
      worker_incarnation: z.null(),
      failure_reason: NonBlank
    })
    .strict()
])

export const ClaimPtyWorkspaceArgsSchema = z
  .object({ requestId: RequestId, workspaceId: RequestId })
  .strict()

export const PtyWorkspaceClaimSchema = z
  .object({
    request_id: RequestId,
    workspace_id: RequestId,
    worker_id: RequestId,
    worker_incarnation: PositiveSafeInteger,
    lease_id: PositiveSafeInteger,
    changed: z.boolean(),
    state: z.literal('owned')
  })
  .strict()

export type TauriPtyHostStatus = z.infer<typeof PtyHostStatusSchema>
export type TauriClaimPtyWorkspaceArgs = z.input<typeof ClaimPtyWorkspaceArgsSchema>
export type TauriPtyWorkspaceClaim = z.infer<typeof PtyWorkspaceClaimSchema>
