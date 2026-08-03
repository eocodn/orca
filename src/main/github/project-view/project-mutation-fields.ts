import { githubProjectHost } from '../../../shared/github-project-identity'
import type {
  GitHubProjectFieldMutationValue,
} from '../../../shared/github-project-types'
function githubHostExecOptions(args: { host?: string }): { host: string } {
  return { host: githubProjectHost(args.host) }
}

// ─── Project field mutations ──────────────────────────────────────────

class UnknownFieldMutationKindError extends Error {
  constructor(kind: string) {
    super(`Unknown project field mutation kind: ${kind}`)
  }
}

function graphqlValueForFieldMutation(value: GitHubProjectFieldMutationValue): string {
  // Serialize the value fragment for the GraphQL mutation. We use GraphQL
  // variables for every dynamic piece, so here we only pick the variable name
  // to reference per value kind.
  switch (value.kind) {
    case 'single-select':
      return 'singleSelectOptionId: $value'
    case 'iteration':
      return 'iterationId: $value'
    case 'text':
      return 'text: $value'
    case 'number':
      return 'number: $value'
    case 'date':
      return 'date: $value'
  }
  // Why: keep a runtime guard for malformed IPC payloads while lint enforces
  // that every typed mutation kind is handled above.
  throw new UnknownFieldMutationKindError((value as { kind: string }).kind)
}

function mutationValueVar(value: GitHubProjectFieldMutationValue): {
  type: string
  val: string | number
} {
  switch (value.kind) {
    case 'single-select':
      return { type: 'String!', val: value.optionId }
    case 'iteration':
      return { type: 'String!', val: value.iterationId }
    case 'text':
      return { type: 'String!', val: value.text }
    case 'number':
      return { type: 'Float!', val: value.number }
    case 'date':
      return { type: 'Date!', val: value.date }
  }
  // Why: see graphqlValueForFieldMutation — surface unknown kinds loudly
  // instead of returning undefined and dispatching an invalid mutation.
  throw new UnknownFieldMutationKindError((value as { kind: string }).kind)
}

export { githubHostExecOptions, UnknownFieldMutationKindError, graphqlValueForFieldMutation, mutationValueVar }
