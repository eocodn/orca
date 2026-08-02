import { useCallback, type MutableRefObject } from 'react'
import { applyDocumentTheme } from '@/lib/document-theme'
import type { GlobalSettings } from '../../../../shared/types'

export function useOnboardingLifecycleRoot(
  persistedThemeRef: MutableRefObject<GlobalSettings['theme']>
) {
  return useCallback((node: HTMLElement | null): void => {
    if (node !== null) {
      return
    }
    // Why: theme preview mutates state outside this component, so revert on modal-root detach.
    applyDocumentTheme(persistedThemeRef.current)
  }, [persistedThemeRef])
}
