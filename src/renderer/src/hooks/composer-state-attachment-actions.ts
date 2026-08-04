import { getClientRuntime } from '@/runtime/client-runtime'
import { useCallback, useEffect, useRef, type Dispatch, type MutableRefObject, type RefObject, type SetStateAction } from 'react'
import { toast } from 'sonner'
import { useAppStore } from '@/store'
import { captureDirectSshMutationExpectation } from '@/lib/ssh-mutation-expectation'
import { joinPath } from '@/lib/path'
import { importExternalPathsToRuntime } from '@/runtime/runtime-file-client'
import {
  collectComposerDropUploadResult,
  shouldReportComposerDropUploadFailure
} from './composer-drop-upload-result'
import { isCurrentComposerDropOwner } from './composer-drop-owner'
import { applyComposerNativeFileDrop } from './composer-native-file-drop'
import { translate } from '@/i18n/i18n'

const composerDropStack: symbol[] = []

type RuntimeSettings = ReturnType<typeof useAppStore.getState>['settings']

type ComposerAttachmentContext = {
  setAttachmentPaths: Dispatch<SetStateAction<string[]>>
  setAgentPrompt: Dispatch<SetStateAction<string>>
  promptTextareaRef: RefObject<HTMLTextAreaElement | null>
  promptCaretFrameRef: MutableRefObject<number | null>
  agentPromptRef: MutableRefObject<string>
  cancelPromptCaretFrame: () => void
  selectedRepoSettings: RuntimeSettings
  connectionId: string | null
  selectedRepoPath: string | undefined
  selectedRepoSettingsRef: MutableRefObject<RuntimeSettings>
  connectionIdRef: MutableRefObject<string | null>
  selectedRepoPathRef: MutableRefObject<string | undefined>
}

export function useComposerAttachmentActions({
  setAttachmentPaths,
  setAgentPrompt,
  promptTextareaRef,
  promptCaretFrameRef,
  agentPromptRef,
  cancelPromptCaretFrame,
  selectedRepoSettings,
  connectionId,
  selectedRepoPath,
  selectedRepoSettingsRef,
  connectionIdRef,
  selectedRepoPathRef
}: ComposerAttachmentContext): {
  handleAddAttachment: () => Promise<void>
} {
  const addComposerAttachments = useCallback((paths: string[]): void => {
    if (paths.length === 0) {
      return
    }
    setAttachmentPaths((current) => {
      const next = [...current]
      for (const pathValue of paths) {
        if (!next.includes(pathValue)) {
          next.push(pathValue)
        }
      }
      return next
    })
  }, [])

  const insertComposerFolderPaths = useCallback(
    (folderPaths: string[]): void => {
      if (folderPaths.length === 0) {
        return
      }
      // Why: de-dup within one drop — the OS can deliver the same folder twice when the selection includes an item and its parent.
      const uniqueFolderPaths = Array.from(new Set(folderPaths))
      // Why: quote paths with shell metacharacters so an inserted folder ref stays one token if pasted into a terminal; simple paths stay unadorned.
      const formatPath = (p: string): string => {
        if (/[\s"'$`\\()[\]{}*?!;&|<>#~]/.test(p)) {
          return `"${p.replace(/(["\\$`])/g, '\\$1')}"`
        }
        return p
      }
      const insertion = uniqueFolderPaths.map(formatPath).join(' ')
      const textarea = promptTextareaRef.current
      // Why: compute selection/insertion/caret outside the setAgentPrompt updater so it stays pure — Strict Mode double-invokes updaters in dev.
      const current = agentPromptRef.current
      const selStart = textarea?.selectionStart ?? current.length
      const selEnd = textarea?.selectionEnd ?? current.length
      const before = current.slice(0, selStart)
      const after = current.slice(selEnd)
      // Why: pad with spaces when the caret abuts text so the folder path doesn't merge into an adjacent word.
      const needsLeadingSpace = before.length > 0 && !/\s$/.test(before)
      const needsTrailingSpace = after.length > 0 && !/^\s/.test(after)
      const padded = `${needsLeadingSpace ? ' ' : ''}${insertion}${needsTrailingSpace ? ' ' : ''}`
      const caret = before.length + padded.length
      if (textarea) {
        cancelPromptCaretFrame()
        promptCaretFrameRef.current = requestAnimationFrame(() => {
          promptCaretFrameRef.current = null
          if (promptTextareaRef.current !== textarea || !textarea.isConnected) {
            return
          }
          textarea.focus()
          textarea.setSelectionRange(caret, caret)
        })
      }
      // Why: pass a plain value (not an updater) since before/after were already resolved, keeping the write pure under Strict-Mode double-render.
      setAgentPrompt(before + padded + after)
    },
    [cancelPromptCaretFrame]
  )

  const uploadComposerPaths = useCallback(
    async (
      sourcePaths: string[],
      targetSettings = selectedRepoSettings,
      targetConnectionId = connectionId,
      targetRepoPath = selectedRepoPath,
      canReportFailure: () => boolean = () => true
    ): Promise<{ filePaths: string[]; folderPaths: string[] } | null> => {
      if (!targetSettings?.activeRuntimeEnvironmentId?.trim() && !targetConnectionId) {
        return null
      }
      if (!targetRepoPath) {
        if (canReportFailure()) {
          toast.error(
            translate(
              'auto.hooks.useComposerState.3db83fc58a',
              'No project path is available on this host for attachments.'
            )
          )
        }
        return { filePaths: [], folderPaths: [] }
      }
      const destinationDir = joinPath(targetRepoPath, '.orca/drops')
      const sshExpectation = targetConnectionId
        ? captureDirectSshMutationExpectation(
            useAppStore.getState(),
            targetConnectionId,
            targetSettings?.activeRuntimeEnvironmentId
          )
        : {
            expectedExecutionHostId: 'local' as const,
            expectedSshTargetId: undefined,
            expectedSshConnectionGeneration: undefined
          }
      const assertCurrent = targetConnectionId
        ? () => {
            const current = captureDirectSshMutationExpectation(
              useAppStore.getState(),
              targetConnectionId,
              targetSettings?.activeRuntimeEnvironmentId
            )
            if (
              current.expectedSshTargetId !== sshExpectation.expectedSshTargetId ||
              current.expectedSshConnectionGeneration !==
                sshExpectation.expectedSshConnectionGeneration
            ) {
              throw new Error('Attachment upload host changed; retry the upload.')
            }
          }
        : undefined
      const { results } = await importExternalPathsToRuntime(
        {
          settings: targetSettings,
          worktreeId: targetRepoPath,
          worktreePath: targetRepoPath,
          connectionId: targetConnectionId ?? undefined,
          ...sshExpectation
        },
        sourcePaths,
        destinationDir,
        { ensureDestinationDir: true, assertCurrent }
      )
      const uploadResult = collectComposerDropUploadResult(results)
      if (shouldReportComposerDropUploadFailure(uploadResult, canReportFailure)) {
        toast.error(
          translate(
            'auto.hooks.useComposerState.a9ff236145',
            'Some attachments could not be uploaded.'
          )
        )
      }
      return { filePaths: uploadResult.filePaths, folderPaths: uploadResult.folderPaths }
    },
    [connectionId, selectedRepoPath, selectedRepoSettings]
  )

  const handleAddAttachment = useCallback(async (): Promise<void> => {
    try {
      const selectedPath = await window.api.shell.pickAttachment()
      if (!selectedPath) {
        return
      }
      const uploaded = await uploadComposerPaths([selectedPath])
      if (uploaded) {
        addComposerAttachments(uploaded.filePaths)
        insertComposerFolderPaths(uploaded.folderPaths)
        return
      }
      addComposerAttachments([selectedPath])
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to add attachment.'
      toast.error(message)
    }
  }, [addComposerAttachments, insertComposerFolderPaths, uploadComposerPaths])

  const applyLocalComposerDrop = useCallback(
    async (paths: string[], canApply: () => boolean = () => true): Promise<void> => {
      const fileAttachments: string[] = []
      const folderPaths: string[] = []
      for (const filePath of paths) {
        try {
          await getClientRuntime().file.authorizeExternalPath({ targetPath: filePath })
          const stat = await getClientRuntime().file.stat({ filePath })
          if (stat.isDirectory) {
            folderPaths.push(filePath)
          } else {
            fileAttachments.push(filePath)
          }
        } catch {
          // Skip paths we cannot authorize or stat.
        }
      }

      if (!canApply()) {
        return
      }
      addComposerAttachments(fileAttachments)
      insertComposerFolderPaths(folderPaths)
    },
    [addComposerAttachments, insertComposerFolderPaths]
  )
  const addComposerAttachmentsRef = useRef(addComposerAttachments)
  addComposerAttachmentsRef.current = addComposerAttachments
  const insertComposerFolderPathsRef = useRef(insertComposerFolderPaths)
  insertComposerFolderPathsRef.current = insertComposerFolderPaths
  const uploadComposerPathsRef = useRef(uploadComposerPaths)
  uploadComposerPathsRef.current = uploadComposerPaths
  const applyLocalComposerDropRef = useRef(applyLocalComposerDrop)
  applyLocalComposerDropRef.current = applyLocalComposerDrop

  // Why: native OS file drops relay via the preload bridge; files become attachments, folders paste inline at the caret since a path can't be embedded as file content.
  const instanceIdRef = useRef<symbol>(Symbol('composer'))
  useEffect(() => {
    const instanceId = instanceIdRef.current
    composerDropStack.push(instanceId)
    const unsubscribe = window.api.ui.onFileDrop((data) => {
      if (data.target !== 'composer') {
        return
      }
      // Why: only the top-of-stack composer owns the drop; earlier subscribers short-circuit so page+modal don't double-apply it.
      if (!isCurrentComposerDropOwner(composerDropStack, instanceId)) {
        return
      }
      const isStillDropOwner = (): boolean =>
        isCurrentComposerDropOwner(composerDropStack, instanceId)
      void applyComposerNativeFileDrop({
        paths: data.paths,
        isCurrentOwner: isStillDropOwner,
        uploadPaths: (paths) =>
          uploadComposerPathsRef.current(
            paths,
            selectedRepoSettingsRef.current,
            connectionIdRef.current,
            selectedRepoPathRef.current,
            isStillDropOwner
          ),
        applyLocalPaths: applyLocalComposerDropRef.current,
        addAttachments: addComposerAttachmentsRef.current,
        insertFolderPaths: insertComposerFolderPathsRef.current,
        onError: (error) =>
          toast.error(error instanceof Error ? error.message : 'Failed to drop files.')
      })
    })
    return () => {
      unsubscribe()
      const idx = composerDropStack.lastIndexOf(instanceId)
      if (idx !== -1) {
        composerDropStack.splice(idx, 1)
      }
    }
  }, [])

  return { handleAddAttachment }
}
