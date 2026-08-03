export type PtySpawnPreparationOutcome<TPrepared, TResult> =
  | { kind: 'fresh'; prepared: TPrepared }
  | { kind: 'duplicate'; promise: Promise<TResult> }

export function makePtySpawnPreparationOutcome<TPrepared, TResult>(
  prepared: TPrepared,
  existingPromise?: Promise<TResult>
): PtySpawnPreparationOutcome<TPrepared, TResult> {
  return existingPromise
    ? { kind: 'duplicate', promise: existingPromise }
    : { kind: 'fresh', prepared }
}

export function makePtySpawnDuplicatePreparationOutcome<TResult>(
  promise: Promise<TResult>
): PtySpawnPreparationOutcome<never, TResult> {
  return { kind: 'duplicate', promise }
}

export function resolvePtySpawnPreparation<TPrepared, TResult>(
  outcome: PtySpawnPreparationOutcome<TPrepared, TResult>,
  executeFresh: (prepared: TPrepared) => Promise<TResult>
): Promise<TResult> {
  return outcome.kind === 'duplicate' ? outcome.promise : executeFresh(outcome.prepared)
}
