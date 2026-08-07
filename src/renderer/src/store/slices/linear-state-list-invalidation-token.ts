export const LINEAR_LIST_INVALIDATION_VERSION_CAP = 10_000

export type LinearListInvalidationToken = {
  scope: string
  version: number
}

let token: LinearListInvalidationToken = { scope: '', version: 0 }

export function getLinearListInvalidationToken(): LinearListInvalidationToken {
  return token
}

export function advanceLinearListInvalidationToken(scope: string): LinearListInvalidationToken {
  const version =
    token.scope === scope ? (token.version + 1) % LINEAR_LIST_INVALIDATION_VERSION_CAP || 1 : 1
  token = { scope, version }
  return token
}
