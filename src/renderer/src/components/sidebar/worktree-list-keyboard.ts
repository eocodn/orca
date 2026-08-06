import { useCallback, useEffect } from 'react'
import type React from 'react'
import { getShortcutPlatform } from '@/lib/shortcut-platform'
import { keybindingMatchesAction } from '../../../../shared/keybindings'
import { isEditableTarget } from './worktree-list-row-dom'

export function useWorktreeListKeyboard({
  activeModal,
  keybindings,
  scrollRef,
  markDirectScrollInput,
  markScrollMovement,
  navigateWorktree
}: {
  activeModal: string
  keybindings: Parameters<typeof keybindingMatchesAction>[3]
  scrollRef: React.RefObject<HTMLDivElement | null>
  markDirectScrollInput: () => void
  markScrollMovement: () => void
  navigateWorktree: (direction: 'up' | 'down') => void
}) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (activeModal !== 'none' || isEditableTarget(event.target)) {
        return
      }
      const platform = getShortcutPlatform()
      if (keybindingMatchesAction('sidebar.focusWorktreeList', event, platform, keybindings)) {
        scrollRef.current?.focus()
        event.preventDefault()
        return
      }
      const direction = keybindingMatchesAction('worktree.navigateUp', event, platform, keybindings)
        ? 'up'
        : keybindingMatchesAction('worktree.navigateDown', event, platform, keybindings)
          ? 'down'
          : null
      if (direction) {
        markDirectScrollInput()
        navigateWorktree(direction)
        event.preventDefault()
      }
    }
    window.addEventListener('keydown', handleKeyDown, { capture: true })
    return () => window.removeEventListener('keydown', handleKeyDown, { capture: true })
  }, [activeModal, keybindings, markDirectScrollInput, navigateWorktree, scrollRef])

  const handleContainerKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        if (event.target !== event.currentTarget) {
          return
        }
        markDirectScrollInput()
        navigateWorktree(event.key === 'ArrowUp' ? 'up' : 'down')
        event.preventDefault()
      } else if (event.key === 'Enter') {
        const helper = document.querySelector(
          '.xterm-helper-textarea'
        ) as HTMLTextAreaElement | null
        helper?.focus()
        event.preventDefault()
      } else if (['PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) {
        markDirectScrollInput()
      }
    },
    [markDirectScrollInput, navigateWorktree]
  )

  const handleScrollPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const scrollbarWidth = event.currentTarget.offsetWidth - event.currentTarget.clientWidth
      if (scrollbarWidth <= 0) {
        return
      }
      const rect = event.currentTarget.getBoundingClientRect()
      if (event.clientX >= rect.right - scrollbarWidth) {
        markDirectScrollInput()
      }
    },
    [markDirectScrollInput]
  )
  const handleScroll = useCallback(() => markScrollMovement(), [markScrollMovement])

  return { handleContainerKeyDown, handleScrollPointerDown, handleScroll }
}
