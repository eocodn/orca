import React from 'react'
import { TaskPageView } from './task-page-view'
import { useTaskPageController } from './use-task-page-controller'

export default function TaskPage(): React.JSX.Element {
  return <TaskPageView controller={useTaskPageController()} />
}
