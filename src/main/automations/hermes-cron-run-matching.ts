import { FULL_SESSION_LOG_HEADING, MAX_SESSION_OUTPUT_GAP_MS, asString, isRecord, sortableTimeFromRunKey, type HermesMergedRunRef, type HermesOutputRunRef, type HermesSessionRunRef } from "./hermes-cron-primitives"

function getRunKey(run: unknown): string | null {
  return isRecord(run) ? asString(run.run_key) : null
}

function getRunOutputContent(run: unknown): string | null {
  return isRecord(run) ? asString(run.output_content) : null
}

function mergeOutputAndSessionContent(
  outputContent: string | null,
  sessionContent: string | null
): string | null {
  if (!sessionContent) {
    return outputContent
  }
  if (!outputContent) {
    return `${FULL_SESSION_LOG_HEADING}\n\n${sessionContent}`
  }
  if (outputContent.includes(FULL_SESSION_LOG_HEADING)) {
    return outputContent
  }
  return `${outputContent}\n\n---\n\n${FULL_SESSION_LOG_HEADING}\n\n${sessionContent}`
}

function findMatchingSessionRunIndex(
  outputRun: unknown,
  sessionRuns: unknown[],
  usedSessionRunIndexes: Set<number>
): number | null {
  const outputRunKey = getRunKey(outputRun)
  const exactMatchIndex = sessionRuns.findIndex(
    (sessionRun, index) =>
      !usedSessionRunIndexes.has(index) && getRunKey(sessionRun) === outputRunKey
  )
  if (exactMatchIndex >= 0) {
    return exactMatchIndex
  }

  const outputTime = sortableTimeFromRunKey(outputRunKey)
  if (!Number.isFinite(outputTime)) {
    return null
  }

  let bestIndex: number | null = null
  let bestGap = Number.POSITIVE_INFINITY
  for (let index = 0; index < sessionRuns.length; index += 1) {
    if (usedSessionRunIndexes.has(index)) {
      continue
    }
    const sessionTime = sortableTimeFromRunKey(getRunKey(sessionRuns[index]))
    if (!Number.isFinite(sessionTime)) {
      continue
    }
    const gap = outputTime - sessionTime
    if (gap < 0 || gap > MAX_SESSION_OUTPUT_GAP_MS || gap >= bestGap) {
      continue
    }
    bestIndex = index
    bestGap = gap
  }
  return bestIndex
}

export function mergeHermesOutputAndSessionRuns(outputRuns: unknown[], sessionRuns: unknown[]): unknown[] {
  const usedSessionRunIndexes = new Set<number>()
  const mergedOutputRuns = outputRuns.map((outputRun) => {
    if (!isRecord(outputRun)) {
      return outputRun
    }
    const sessionRunIndex = findMatchingSessionRunIndex(
      outputRun,
      sessionRuns,
      usedSessionRunIndexes
    )
    if (sessionRunIndex === null) {
      return outputRun
    }
    const sessionRun = sessionRuns[sessionRunIndex]
    if (!isRecord(sessionRun)) {
      return outputRun
    }
    usedSessionRunIndexes.add(sessionRunIndex)
    // Hermes writes the markdown output at completion, while state.db keeps
    // the actual turn-by-turn transcript under the cron session start time.
    return {
      ...outputRun,
      output_preview: asString(outputRun.output_preview) ?? asString(sessionRun.output_preview),
      output_content: mergeOutputAndSessionContent(
        getRunOutputContent(outputRun),
        getRunOutputContent(sessionRun)
      )
    }
  })
  return [
    ...mergedOutputRuns,
    ...sessionRuns.filter((_, index) => !usedSessionRunIndexes.has(index))
  ]
}

export function mergeHermesOutputAndSessionRunRefs(
  outputRefs: HermesOutputRunRef[],
  sessionRefs: HermesSessionRunRef[]
): HermesMergedRunRef[] {
  const usedSessionRunIndexes = new Set<number>()
  const mergedOutputRefs = outputRefs.map((outputRef) => {
    const sessionRunIndex = findMatchingSessionRunIndex(
      outputRef,
      sessionRefs,
      usedSessionRunIndexes
    )
    const sessionRef = sessionRunIndex === null ? null : sessionRefs[sessionRunIndex]
    if (sessionRunIndex !== null) {
      usedSessionRunIndexes.add(sessionRunIndex)
    }
    return {
      id: outputRef.id,
      job_id: outputRef.job_id,
      run_at: outputRef.run_at,
      run_key: outputRef.run_key,
      output: outputRef,
      session: sessionRef
    }
  })
  return [
    ...mergedOutputRefs,
    ...sessionRefs
      .filter((_, index) => !usedSessionRunIndexes.has(index))
      .map((sessionRef) => ({
        id: sessionRef.id,
        job_id: sessionRef.job_id,
        run_at: sessionRef.run_at,
        run_key: sessionRef.run_key,
        output: null,
        session: sessionRef
      }))
  ]
}
