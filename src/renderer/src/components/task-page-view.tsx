import type React from 'react'
import type { TaskPageController } from './use-task-page-controller'
import { TaskPageToolbarView } from './task-page-toolbar-view'
import { TaskPageContentView } from './task-page-content-view'
import { TaskPageDialogsView } from './task-page-dialogs-view'

type Props = { controller: TaskPageController }

export function TaskPageView({ controller }: Props): React.JSX.Element {
  return (
    <div className="relative flex h-full min-h-0 flex-1 overflow-hidden bg-background text-foreground">
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="mx-auto flex min-h-0 min-w-0 w-full flex-1 flex-col px-5 pt-1.5 pb-4 md:px-8 md:pt-1.5 md:pb-5">
          <TaskPageToolbarView controller={controller} />
          <TaskPageContentView controller={controller} />
        </div>
      </div>
      <TaskPageDialogsView controller={controller} />
    </div>
  )
}
