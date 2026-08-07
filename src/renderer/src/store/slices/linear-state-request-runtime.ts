type InflightLinearStatusRequest = {
  contextKey: string
  promise: Promise<void>
}

export const linearRequestRuntimeState: {
  inflightStatusRequest: InflightLinearStatusRequest | null
  statusReadGeneration: number
  mutationGeneration: number
  cacheGeneration: number
} = {
  inflightStatusRequest: null,
  statusReadGeneration: 0,
  mutationGeneration: 0,
  cacheGeneration: 0
}
