import { useCallback } from 'react'
import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import { persistStep } from './use-onboarding-flow-persistence'

type OnboardingSshSettingsContext = Record<string, any>

export function useOnboardingSshSettingsAction(context: OnboardingSshSettingsContext) {
  const {
    busyLabel,
    setError,
    onOnboardingChange,
    currentStep,
    onSettingsDetourStart,
    openSettingsTarget,
    openSettingsPage
  } = context

  return useCallback(async () => {
    if (busyLabel) {
      return
    }
    setError(null)
    try {
      onOnboardingChange(await persistStep(currentStep.stepNumber - 1))
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
      toast.error(
        translate(
          'auto.components.onboarding.use.onboarding.flow.dce4bdce5b',
          'Could not open SSH settings'
        ),
        { description: message }
      )
      return
    }
    // Why: SSH users need a temporary Settings detour without dismissing required repo setup.
    onSettingsDetourStart?.()
    openSettingsTarget({ pane: 'ssh', repoId: null, sectionId: 'ssh' })
    openSettingsPage()
  }, [
    busyLabel,
    currentStep.stepNumber,
    onOnboardingChange,
    onSettingsDetourStart,
    openSettingsPage,
    openSettingsTarget
  ])
}
