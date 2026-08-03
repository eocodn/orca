import type { StateCreator } from 'zustand'
import type { AppState } from '../types'

type SliceSet = Parameters<StateCreator<AppState>>[0]
type SliceGet = Parameters<StateCreator<AppState>>[1]

export function createWorkspaceCleanupSliceSetStateActions2(_set: SliceSet, _get: SliceGet) {
  return {}
}
