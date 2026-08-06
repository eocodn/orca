import type React from 'react'

import { TaskPageCodeHostContentView } from './task-page-code-host-content-view'
import { TaskPageJiraContentView } from './task-page-jira-content-view'
import { TaskPageLinearContentView } from './task-page-linear-content-view'
import type { TaskPageController } from './use-task-page-controller'

type Props = { controller: TaskPageController }

export function TaskPageContentView({ controller }: Props): React.JSX.Element | null {
  if (controller.taskSource === 'github' || controller.taskSource === 'gitlab') {
    return <TaskPageCodeHostContentView controller={controller} />
  }
  if (controller.taskSource === 'jira') {
    return <TaskPageJiraContentView controller={controller} />
  }
  if (controller.taskSource === 'linear') {
    return <TaskPageLinearContentView controller={controller} />
  }
  return null
}
