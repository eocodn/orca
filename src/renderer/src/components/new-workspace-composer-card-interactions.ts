import React from 'react'
import type { SshConnectionStatus } from '../../../shared/ssh-types'
import { WORKSPACE_FILE_PATH_MIME } from '@/lib/workspace-file-drag'
import { translate } from '@/i18n/i18n'

const SSH_STATUS_LABELS: Partial<Record<SshConnectionStatus, string>> = {
  get disconnected() {
    return translate(
      'auto.components.NewWorkspaceComposerCard.sshNotConnected',
      'SSH not connected'
    )
  },
  get connecting() {
    return translate('auto.components.NewWorkspaceComposerCard.connectingSsh', 'Connecting SSH...')
  },
  get 'auth-failed'() {
    return translate(
      'auto.components.NewWorkspaceComposerCard.sshAuthenticationFailed',
      'SSH authentication failed'
    )
  },
  get 'deploying-relay'() {
    return translate(
      'auto.components.NewWorkspaceComposerCard.preparingSshConnection',
      'Preparing SSH connection...'
    )
  },
  get connected() {
    return translate('auto.components.NewWorkspaceComposerCard.connected', 'Connected')
  },
  get reconnecting() {
    return translate(
      'auto.components.NewWorkspaceComposerCard.reconnectingSsh',
      'Reconnecting SSH...'
    )
  },
  get 'reconnection-failed'() {
    return translate(
      'auto.components.NewWorkspaceComposerCard.sshReconnectionFailed',
      'SSH reconnection failed'
    )
  },
  get error() {
    return translate('auto.components.NewWorkspaceComposerCard.a239038146', 'SSH connection error')
  }
}
export function getSshStatusLabel(status: SshConnectionStatus): string {
  return SSH_STATUS_LABELS[status] ?? status
}

// Why: bound how long the run-target picker waits on a host connect so a stalled backend
// connect can't leave the row's disabled/spinner state stuck forever. The backend keeps going.
const RUN_TARGET_CONNECT_UI_TIMEOUT_MS = 20_000

export async function withUiConnectTimeout<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(
        new Error(
          translate(
            'auto.components.NewWorkspaceComposerCard.connectTimedOut',
            'Connection timed out. It may still be connecting in the background.'
          )
        )
      )
    }, RUN_TARGET_CONNECT_UI_TIMEOUT_MS)
  })
  try {
    return await Promise.race([promise, timeout])
  } finally {
    if (timer) {
      clearTimeout(timer)
    }
  }
}


export function useComposerFileDragOver(): {
  isFileDragOver: boolean
  dragHandlers: {
    onDragEnter: (event: React.DragEvent<HTMLDivElement>) => void
    onDragLeave: (event: React.DragEvent<HTMLDivElement>) => void
  }
} {
  const [isFileDragOver, setIsFileDragOver] = React.useState(false)
  const dragCounterRef = React.useRef(0)

  const reset = React.useCallback(() => {
    dragCounterRef.current = 0
    setIsFileDragOver(false)
  }, [])

  const onDragEnter = React.useCallback((event: React.DragEvent<HTMLDivElement>): void => {
    // Why: "Files" is the DataTransfer type the OS adds for native drags; skip internal drags so they route to their own handlers.
    if (!event.dataTransfer.types.includes('Files')) {
      return
    }
    if (event.dataTransfer.types.includes(WORKSPACE_FILE_PATH_MIME)) {
      return
    }
    dragCounterRef.current += 1
    setIsFileDragOver(true)
  }, [])

  const onDragLeave = React.useCallback(
    (event: React.DragEvent<HTMLDivElement>): void => {
      if (!event.dataTransfer.types.includes('Files')) {
        return
      }
      // Why: mirror the onDragEnter guard so internal drags don't decrement a counter enter skipped incrementing (else it goes negative).
      if (event.dataTransfer.types.includes(WORKSPACE_FILE_PATH_MIME)) {
        return
      }
      dragCounterRef.current -= 1
      if (dragCounterRef.current <= 0) {
        reset()
      }
    },
    [reset]
  )

  // Why: preload stops native drop events before React's onDrop, so reset the drag highlight via a document capture listener.
  React.useEffect(() => {
    const handler = (): void => {
      reset()
    }
    document.addEventListener('drop', handler, true)
    document.addEventListener('dragend', handler, true)
    return () => {
      document.removeEventListener('drop', handler, true)
      document.removeEventListener('dragend', handler, true)
    }
  }, [reset])

  return {
    isFileDragOver,
    dragHandlers: { onDragEnter, onDragLeave }
  }
}
