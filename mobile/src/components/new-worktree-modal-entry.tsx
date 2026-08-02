import { useRef } from 'react'
import type { Props } from './new-worktree-modal-contract'
import { NewWorktreeModalContent } from './new-worktree-modal-route'

export function NewWorktreeModal({
  visible,
  client,
  hostId,
  existingWorktreePaths,
  existingWorktrees,
  onCreated,
  onClose
}: Props) {
  const openEpochRef = useRef(0)
  const wasVisibleRef = useRef(false)
  const clientEpochRef = useRef({ client, epoch: 0 })

  // Why: each drawer opening is a fresh form session; remounting resets local
  // form state before paint instead of clearing it in a visible-prop Effect.
  if (visible && !wasVisibleRef.current) {
    openEpochRef.current += 1
  }
  wasVisibleRef.current = visible
  if (clientEpochRef.current.client !== client) {
    clientEpochRef.current = { client, epoch: clientEpochRef.current.epoch + 1 }
  }

  return (
    <NewWorktreeModalContent
      key={`${openEpochRef.current}:${clientEpochRef.current.epoch}`}
      visible={visible}
      client={client}
      hostId={hostId}
      existingWorktreePaths={existingWorktreePaths}
      existingWorktrees={existingWorktrees}
      onCreated={onCreated}
      onClose={onClose}
    />
  )
}


