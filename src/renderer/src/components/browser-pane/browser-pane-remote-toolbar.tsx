import { ArrowLeft, ArrowRight, Loader2, MessageSquarePlus, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { translate } from '@/i18n/i18n'
import BrowserAddressBar from './BrowserAddressBar'
import { MarkupDrawButton } from './markup/MarkupDrawButton'
import type { RemoteBrowserSurfaceRenderContext } from './browser-pane-remote-surface-render-types'

export function RemoteBrowserToolbar({
  addressBarInputRef,
  addressBarValue,
  browserTab,
  busy,
  frameUrl,
  isActive,
  markup,
  navigateToUrl,
  runRemoteNavigation,
  setAddressBarValue,
  submitAddressBar
}: Pick<RemoteBrowserSurfaceRenderContext, 'addressBarInputRef' | 'addressBarValue' | 'browserTab' | 'busy' | 'frameUrl' | 'isActive' | 'markup' | 'navigateToUrl' | 'runRemoteNavigation' | 'setAddressBarValue' | 'submitAddressBar'>): React.JSX.Element {
  return (
    <div className="relative z-10 flex items-center gap-2 border-b border-border/70 bg-background/95 px-3 py-1.5" data-contextual-tour-target="browser-toolbar">
      <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => void runRemoteNavigation('browser.back')}>
        <ArrowLeft className="size-4" />
      </Button>
      <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => void runRemoteNavigation('browser.forward')}>
        <ArrowRight className="size-4" />
      </Button>
      <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => void runRemoteNavigation('browser.reload')}>
        {busy || browserTab.loading ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
      </Button>
      <BrowserAddressBar value={addressBarValue} onChange={setAddressBarValue} onSubmit={submitAddressBar} onNavigate={navigateToUrl} inputRef={addressBarInputRef} />
      <Tooltip>
        <TooltipTrigger asChild>
          <Button size="icon" variant="ghost" className="h-7 w-7 opacity-50" aria-disabled="true" aria-label={translate('auto.components.browser.pane.BrowserPane.deb5293610', 'Browser annotations unavailable in remote runtime')} onClick={(event) => event.preventDefault()}>
            <MessageSquarePlus className="size-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom" sideOffset={4}>
          {translate('auto.components.browser.pane.BrowserPane.8b7e6d1f5a', 'Browser annotations are only available in local browser tabs.')}
        </TooltipContent>
      </Tooltip>
      <MarkupDrawButton onClick={() => (markup.isActive ? markup.cancel() : void markup.start())} disabled={!frameUrl} active={markup.isActive} surfaceActive={isActive} className="h-7 w-7" />
    </div>
  )
}
