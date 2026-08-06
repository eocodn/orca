import { useEffect, useRef } from 'react'
import type { Dispatch, MutableRefObject, SetStateAction } from 'react'

import type { TaskProvider } from '../../../shared/task-providers'
import { resolveVisibleTaskProvider } from '../../../shared/task-providers'

type TaskPageSourceSynchronizationProps = {
  pageTaskSource: TaskProvider | undefined
  preferredTaskSource: TaskProvider
  defaultTaskSource: TaskProvider | undefined
  taskSource: TaskProvider
  visibleTaskProviders: readonly TaskProvider[]
  setTaskSource: Dispatch<SetStateAction<TaskProvider>>
  taskSourceManuallyChangedRef: MutableRefObject<boolean>
}

export function useTaskPageSourceSynchronization({
  pageTaskSource,
  preferredTaskSource,
  defaultTaskSource,
  taskSource,
  visibleTaskProviders,
  setTaskSource,
  taskSourceManuallyChangedRef
}: TaskPageSourceSynchronizationProps): void {
  const lastPageTaskSourceRef = useRef<TaskProvider | undefined>(pageTaskSource)

  useEffect(() => {
    const pageTaskSourceChanged = lastPageTaskSourceRef.current !== pageTaskSource
    lastPageTaskSourceRef.current = pageTaskSource
    if (pageTaskSource) {
      if (pageTaskSourceChanged) {
        taskSourceManuallyChangedRef.current = false
      } else if (taskSourceManuallyChangedRef.current) {
        return
      }
      setTaskSource(resolveVisibleTaskProvider(pageTaskSource, visibleTaskProviders))
    }
  }, [pageTaskSource, setTaskSource, taskSourceManuallyChangedRef, visibleTaskProviders])

  useEffect(() => {
    if (taskSourceManuallyChangedRef.current) {
      return
    }
    // Why: provider checks can finish after mount; restore the saved default only when it is visible.
    if (visibleTaskProviders.includes(preferredTaskSource) && taskSource !== preferredTaskSource) {
      setTaskSource(preferredTaskSource)
    }
  }, [
    preferredTaskSource,
    setTaskSource,
    taskSource,
    taskSourceManuallyChangedRef,
    visibleTaskProviders
  ])

  useEffect(() => {
    if (!visibleTaskProviders.includes(taskSource)) {
      setTaskSource(resolveVisibleTaskProvider(defaultTaskSource, visibleTaskProviders))
    }
  }, [defaultTaskSource, setTaskSource, taskSource, visibleTaskProviders])
}
