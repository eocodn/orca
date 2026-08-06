import { useEffect } from 'react'
import type { RefObject } from 'react'

import { useContextualTour } from '@/components/contextual-tours/use-contextual-tour'

type Props = {
  taskSource: string
  githubMode: string
  taskSearchInputRef: RefObject<HTMLInputElement | null>
  dialogWorkItem: unknown | null
  gitlabDialogItem: unknown | null
  selectedLinearIssue: unknown | null
  selectedJiraIssue: unknown | null
  newIssueOpen: boolean
  newLinearProjectOpen: boolean
  newLinearIssueOpen: boolean
  newJiraIssueOpen: boolean
  linearConnectOpen: boolean
  jiraConnectOpen: boolean
  activeModal: string
  closeTaskPage: () => void
  preflightStatusCurrent: boolean
  preflightStatusChecked: boolean
  linearStatusReady: boolean
  jiraStatusReady: boolean
  refreshPreflightStatus: () => Promise<unknown> | void
  checkLinearConnection: () => Promise<unknown> | void
  checkJiraConnection: () => Promise<unknown> | void
  providerRuntimeContextKey: string
  preflightStatusContextKey: string | null
  expectedPreflightContextKey: string
  linearStatusContextKey: string | null
  jiraStatusContextKey: string | null
}

export function useTaskPageGlobalLifecycle({
  taskSource,
  githubMode,
  taskSearchInputRef,
  dialogWorkItem,
  gitlabDialogItem,
  selectedLinearIssue,
  selectedJiraIssue,
  newIssueOpen,
  newLinearProjectOpen,
  newLinearIssueOpen,
  newJiraIssueOpen,
  linearConnectOpen,
  jiraConnectOpen,
  activeModal,
  closeTaskPage,
  preflightStatusCurrent,
  preflightStatusChecked,
  linearStatusReady,
  jiraStatusReady,
  refreshPreflightStatus,
  checkLinearConnection,
  checkJiraConnection,
  providerRuntimeContextKey,
  preflightStatusContextKey,
  expectedPreflightContextKey,
  linearStatusContextKey,
  jiraStatusContextKey
}: Props): void {
  useContextualTour(
    'tasks',
    !dialogWorkItem &&
      !gitlabDialogItem &&
      !selectedLinearIssue &&
      !newIssueOpen &&
      !newLinearProjectOpen &&
      !newLinearIssueOpen &&
      !linearConnectOpen &&
      !jiraConnectOpen &&
      activeModal === 'none',
    'tasks_open'
  )

  useEffect(() => {
    if (
      taskSource !== 'github' ||
      githubMode !== 'items' ||
      dialogWorkItem ||
      newIssueOpen ||
      newLinearProjectOpen ||
      newLinearIssueOpen ||
      newJiraIssueOpen ||
      activeModal !== 'none'
    ) {
      return
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      const modifierPressed = navigator.userAgent.includes('Mac') ? event.metaKey : event.ctrlKey
      if (!modifierPressed || event.altKey || event.shiftKey || event.key.toLowerCase() !== 'f') {
        return
      }
      const input = taskSearchInputRef.current
      if (!input) {
        return
      }
      const target = event.target
      if (
        target instanceof HTMLElement &&
        target !== input &&
        (target instanceof HTMLInputElement ||
          target instanceof HTMLTextAreaElement ||
          target.isContentEditable)
      ) {
        return
      }
      event.preventDefault()
      event.stopPropagation()
      input.focus()
      input.select()
    }
    window.addEventListener('keydown', onKeyDown, { capture: true })
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true })
  }, [
    activeModal,
    dialogWorkItem,
    githubMode,
    newIssueOpen,
    newJiraIssueOpen,
    newLinearIssueOpen,
    newLinearProjectOpen,
    taskSearchInputRef,
    taskSource
  ])

  useEffect(() => {
    if (
      dialogWorkItem ||
      selectedJiraIssue ||
      selectedLinearIssue ||
      newIssueOpen ||
      newLinearIssueOpen ||
      newJiraIssueOpen ||
      activeModal !== 'none'
    ) {
      return
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || !(event.target instanceof HTMLElement)) {
        return
      }
      const target = event.target
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        target.isContentEditable
      ) {
        event.preventDefault()
        target.blur()
        return
      }
      event.preventDefault()
      closeTaskPage()
    }
    window.addEventListener('keydown', onKeyDown, { capture: true })
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true })
  }, [
    activeModal,
    closeTaskPage,
    dialogWorkItem,
    newIssueOpen,
    newJiraIssueOpen,
    newLinearIssueOpen,
    selectedJiraIssue,
    selectedLinearIssue
  ])

  useEffect(() => {
    if (!preflightStatusCurrent || !preflightStatusChecked) {
      void refreshPreflightStatus()
    }
    if (!linearStatusReady) {
      void checkLinearConnection()
    }
    if (!jiraStatusReady) {
      void checkJiraConnection()
    }
  }, [
    checkJiraConnection,
    checkLinearConnection,
    expectedPreflightContextKey,
    jiraStatusContextKey,
    jiraStatusReady,
    linearStatusContextKey,
    linearStatusReady,
    preflightStatusChecked,
    preflightStatusContextKey,
    preflightStatusCurrent,
    providerRuntimeContextKey,
    refreshPreflightStatus
  ])
}
