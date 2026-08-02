import React from 'react'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet'
import { VisuallyHidden } from 'radix-ui'
import { translate } from '@/i18n/i18n'
import { GitLabItemDialogHeader } from './gitlab-item-dialog-header'
import { GitLabItemDialogTabs } from './gitlab-item-dialog-tabs'
import { GitLabItemDialogFooter } from './gitlab-item-dialog-footer'

export function GitLabItemDialogView({ context }: { context: Record<string, any> }): React.JSX.Element {
  const { item, onClose, visibleTitle } = context

  return (
    <Sheet open={item !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        side="right"
        showCloseButton={false}
        className="flex w-full flex-col gap-0 p-0 sm:max-w-2xl"
      >
        <VisuallyHidden.Root>
          <SheetTitle>
            {item
              ? visibleTitle
              : translate('auto.components.GitLabItemDialog.3a051b8ade', 'Work item')}
          </SheetTitle>
          <SheetDescription>
            {translate('auto.components.GitLabItemDialog.30c97083c2', 'GitLab work item detail')}
          </SheetDescription>
        </VisuallyHidden.Root>
        {item ? (
          <>
            <GitLabItemDialogHeader context={context} />
            <GitLabItemDialogTabs context={context} />
            <GitLabItemDialogFooter context={context} />
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  )
}

