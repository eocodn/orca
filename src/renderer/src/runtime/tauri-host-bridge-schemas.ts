import { z } from 'zod'

export const RequestId = z.string().min(1)
export const PathSchema = z.string().min(1)
const ExecutionTarget = z.enum(['windows-native', 'wsl2', 'ssh'])
const WorkspaceKind = z.enum(['folder', 'git-worktree'])

export const HostStatusSchema = z
  .object({
    service: z.literal('ade-host'),
    workspace_count: z.number().int().nonnegative(),
    ready_workspaces: z.number().int().nonnegative(),
    source: z.literal('sqlite-snapshot'),
    hostProtocol: z
      .object({
        version: z.number().int().positive(),
        capabilities: z.array(z.string())
      })
      .strict()
  })
  .strict()

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
      sequence: z.number().int().nonnegative(),
      data: z.string()
    })
    .strict(),
  z.object({ type: z.literal('exit'), code: z.number().int() }).strict(),
  z.object({ type: z.literal('fail'), reason: z.string() }).strict(),
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
    terminal_id: z.string().min(1),
    expected_generation: z.number().int().nonnegative(),
    operation: TerminalOperationSchema
  })
  .strict()

export const TerminalResultSchema = z
  .object({
    request_id: RequestId,
    capability: z.literal('terminal'),
    protocol_version: z.literal(1),
    operation: z.enum(['start', 'snapshot', 'output', 'exit', 'fail', 'close']),
    terminal_id: z.string(),
    generation: z.number().int().nonnegative(),
    status: z.enum(['created', 'running', 'exited', 'failed', 'closed']),
    exit_code: z.number().int().nullable(),
    failure_reason: z.string().nullable(),
    output_sequence: z.number().int().nonnegative(),
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
