import { useRef, useState } from 'react'

import { useTaskPageProviderContext } from './use-task-page-provider-context'
import { useTaskPageSourceSelection } from './use-task-page-source-selection'
import { useTaskPageSourceSynchronization } from './use-task-page-source-synchronization'
import { useTaskPageStoreBindings } from './use-task-page-store-bindings'

export function useTaskPageBaseController() {
  const store = useTaskPageStoreBindings()
  const source = useTaskPageSourceSelection(store)
  const provider = useTaskPageProviderContext(store, source)
  const taskSourceManuallyChangedRef = useRef(false)
  const taskResumeAppliedRef = useRef(false)
  const githubSearchPersistReadyRef = useRef(false)
  const linearSearchPersistReadyRef = useRef(false)
  const jiraSearchPersistReadyRef = useRef(false)
  const [taskResumeApplied, setTaskResumeApplied] = useState(false)

  useTaskPageSourceSynchronization({
    defaultTaskSource: store.settings?.defaultTaskSource,
    pageTaskSource: store.pageData.taskSource,
    preferredTaskSource: source.preferredTaskSource,
    setTaskSource: source.setTaskSource,
    taskSource: source.taskSource,
    taskSourceManuallyChangedRef,
    visibleTaskProviders: source.visibleTaskProviders
  })

  return {
    store,
    source,
    provider,
    taskSourceManuallyChangedRef,
    taskResumeAppliedRef,
    githubSearchPersistReadyRef,
    linearSearchPersistReadyRef,
    jiraSearchPersistReadyRef,
    taskResumeApplied,
    setTaskResumeApplied
  }
}

export type TaskPageBaseController = ReturnType<typeof useTaskPageBaseController>
