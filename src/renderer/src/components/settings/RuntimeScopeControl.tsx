import { ServerCog } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAppStore } from '@/store'
import type { RuntimeScope } from './runtime-scope-copy'
import { translate } from '@/i18n/i18n'

type RuntimeScopeControlProps = {
  labelPrefix: string
  scope: RuntimeScope
  className?: string
}

export function RuntimeScopeControl({
  labelPrefix,
  scope,
  className
}: RuntimeScopeControlProps): React.JSX.Element {
  const openSettingsPage = useAppStore((state) => state.openSettingsPage)
  const openSettingsTarget = useAppStore((state) => state.openSettingsTarget)

  const openRuntimeSettings = (): void => {
    openSettingsPage()
    openSettingsTarget({ pane: 'servers', repoId: null, sectionId: 'default-runtime' })
  }

  return (
    <div className={className}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        {/* Keep the runtime action usable when an integration card is narrow. */}
        <div className="min-w-[min(14rem,100%)] flex-1">
          <span className="font-medium text-foreground">
            {translate(
              'auto.components.settings.runtimeScope.scopeLabel',
              '{{value0}}: {{value1}}',
              {
                value0: labelPrefix,
                value1: scope.label
              }
            )}
          </span>
          <div className="mt-0.5 text-muted-foreground">{scope.description}</div>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="shrink-0"
          onClick={openRuntimeSettings}
        >
          <ServerCog className="size-3.5" />
          {translate('auto.components.settings.runtimeScope.openSettings', 'Open Remote Servers')}
        </Button>
      </div>
    </div>
  )
}
