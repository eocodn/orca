import type { StatusBarItem } from '../../../../shared/types'

/** Provider quota toggles were removed; generic indicators are always available. */
export function useAvailableStatusBarToggles<T extends { id: StatusBarItem }>(
  toggles: readonly T[]
): T[] {
  return [...toggles]
}
