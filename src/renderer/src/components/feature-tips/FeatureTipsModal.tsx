import type { JSX } from 'react'
import { useAppStore } from '@/store'
import { CmdJPaletteTipDialog } from './CmdJPaletteTipDialog'
import { getFeatureTipForModal } from './feature-tip-modal-state'
export default function FeatureTipsModal(): JSX.Element | null {
  const activeModal = useAppStore((s) => s.activeModal)
  const closeModal = useAppStore((s) => s.closeModal)
  const openSettingsPage = useAppStore((s) => s.openSettingsPage)
  const openSettingsTarget = useAppStore((s) => s.openSettingsTarget)
  const seenTipIds = useAppStore((s) => s.featureTipsSeenIds)
  const featureInteractions = useAppStore((s) => s.featureInteractions)
  const markFeatureTipsSeen = useAppStore((s) => s.markFeatureTipsSeen)
  const modalData = useAppStore((s) => s.modalData)
  const isOpen = activeModal === 'feature-tips'
  const currentTip = getFeatureTipForModal({
    modalData,
    seenTipIds,
    featureInteractions
  })

  const markCurrentTipSeen = (): void => {
    if (currentTip) {
      markFeatureTipsSeen([currentTip.id])
    }
  }

  const handleOpenChange = (open: boolean): void => {
    if (!open) {
      markCurrentTipSeen()
      closeModal()
    }
  }

  const handleSkip = (): void => {
    markCurrentTipSeen()
    closeModal()
  }

  const openShortcutsSettings = (): void => {
    markCurrentTipSeen()
    closeModal()
    openSettingsTarget({ pane: 'shortcuts', repoId: null })
    openSettingsPage()
  }

  const handlePrimaryAction = (): void => {
    if (!currentTip) {
      return
    }

    markFeatureTipsSeen([currentTip.id])
    closeModal()
  }

  if (!isOpen || !currentTip) {
    return null
  }

  return (
    <CmdJPaletteTipDialog
      open
      tip={currentTip}
      primaryBusy={false}
      onOpenChange={handleOpenChange}
      onPrimaryAction={handlePrimaryAction}
      onSkip={handleSkip}
      onRebindClick={openShortcutsSettings}
    />
  )
}
