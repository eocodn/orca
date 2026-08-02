import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { translate } from '@/i18n/i18n'
import { FloatingTerminalOrchestrationDialog } from './FloatingTerminalOrchestrationDialog'
import { FloatingTerminalResizeHandles } from './FloatingTerminalResizeHandles'
import type { FloatingTerminalPanelRenderContext } from './floating-terminal-panel-render-types'

export function FloatingTerminalPanelOverlays({ context }: { context: FloatingTerminalPanelRenderContext }) {
  const {
    showOrchestrationSetup, activeTabType, dismissOrchestrationSetup, setOrchestrationDialogOpen,
    maximized, bounds, previewUserBounds, commitUserBounds, orchestrationDialogOpen,
    refreshOrchestrationSetupVisibility, saveDialogFileId, handleFloatingSaveDialogCancel,
    saveDialogFile, handleFloatingSaveDialogDiscard, handleFloatingSaveDialogSave
  } = context
  return <>
    {showOrchestrationSetup && activeTabType === 'terminal' ? <div className="absolute right-4 bottom-4 z-10 w-[280px] rounded-md border border-border/60 bg-card/95 p-3 text-card-foreground shadow-xs" data-floating-terminal-no-drag><div className="space-y-2"><div className="space-y-0.5"><p className="text-sm font-medium">{translate('auto.components.floating.terminal.FloatingTerminalPanel.2a3c5ddf5e', 'Enable orchestration')}</p><p className="text-xs leading-5 text-muted-foreground">{translate('auto.components.floating.terminal.FloatingTerminalPanel.8cf80db43b', 'Set up the Orca CLI and agent skill so agents can coordinate through Orca.')}</p></div><div className="flex items-center gap-2"><Button type="button" variant="ghost" size="sm" className="flex-1" onClick={dismissOrchestrationSetup}>{translate('auto.components.floating.terminal.FloatingTerminalPanel.adc281394d', 'Dismiss')}</Button><Button type="button" variant="default" size="sm" className="flex-1" onClick={() => setOrchestrationDialogOpen(true)}>{translate('auto.components.floating.terminal.FloatingTerminalPanel.bbc177f98f', 'Enable')}</Button></div></div></div> : null}
    {!maximized ? <FloatingTerminalResizeHandles bounds={bounds} onPreviewBounds={previewUserBounds} onCommitBounds={commitUserBounds} /> : null}
    <FloatingTerminalOrchestrationDialog open={orchestrationDialogOpen} onOpenChange={setOrchestrationDialogOpen} onSetupStateChange={() => void refreshOrchestrationSetupVisibility()} />
    <Dialog open={saveDialogFileId !== null} onOpenChange={(nextOpen) => { if (!nextOpen) handleFloatingSaveDialogCancel() }}>
      <DialogContent className="max-w-sm"><DialogHeader><DialogTitle className="text-sm">{translate('auto.components.floating.terminal.FloatingTerminalPanel.690b6fb98a', 'Unsaved Changes')}</DialogTitle><DialogDescription className="text-xs">{saveDialogFile ? translate('auto.components.floating.terminal.FloatingTerminalPanel.5ddc688c52', '"{{value0}}" has unsaved changes. Do you want to save before closing?', { value0: saveDialogFile.relativePath.split('/').pop() }) : translate('auto.components.floating.terminal.FloatingTerminalPanel.b085fb58b5', 'This file has unsaved changes.')}</DialogDescription></DialogHeader><DialogFooter className="gap-2"><Button type="button" variant="outline" size="sm" onClick={handleFloatingSaveDialogCancel}>{translate('auto.components.floating.terminal.FloatingTerminalPanel.e7bf09d4d4', 'Cancel')}</Button><Button type="button" variant="outline" size="sm" onClick={handleFloatingSaveDialogDiscard}>{translate('auto.components.floating.terminal.FloatingTerminalPanel.918c2139f3', "Don't Save")}</Button><Button type="button" size="sm" onClick={handleFloatingSaveDialogSave}>{translate('auto.components.floating.terminal.FloatingTerminalPanel.da508bd7f5', 'Save')}</Button></DialogFooter></DialogContent>
    </Dialog>
  </>
}
