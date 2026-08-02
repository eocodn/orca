import React from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { translate } from '@/i18n/i18n'
import { WorkspaceEmojiSuggestionPopover } from './WorkspaceEmojiSuggestionPopover'
import type { JiraUrlSourceState } from './use-jira-url-source'

function jiraStatusMessage(source: JiraUrlSourceState): string {
  if (source.loading) return translate('auto.components.new.workspace.SmartWorkspaceNameField.loadingJira', 'Loading Jira issue…')
  switch (source.errorKind) {
    case 'disconnected': return translate('auto.components.new.workspace.SmartWorkspaceNameField.jiraDisconnected', 'Connect Jira in Settings to link this issue')
    case 'site-not-connected': return translate('auto.components.new.workspace.SmartWorkspaceNameField.jiraSiteNotConnected', 'This Jira site is not connected')
    case 'update-runtime': return translate('auto.components.new.workspace.SmartWorkspaceNameField.jiraRuntimeUpdate', 'Update the remote runtime to link Jira')
    case 'read-failed': return translate('auto.components.new.workspace.SmartWorkspaceNameField.jiraReadFailed', 'Couldn’t load this Jira issue')
    case null:
      return source.accountChoices.length > 0
        ? translate('auto.components.new.workspace.SmartWorkspaceNameField.chooseJiraAccount', 'Choose a Jira account')
        : translate('auto.components.new.workspace.SmartWorkspaceNameField.jiraLoaded', 'Jira issue loaded')
  }
}

export function SmartWorkspaceSourceOverlay({ context }: { context: Record<string, any> }): React.JSX.Element {
  const { crossRepoPrompt, dismissCrossRepoPrompt, emojiMenuOpen, emojiSuggestions, handleEmojiSelect, onOpenJiraSettings, setEmojiCommandValue, setEmojiCursor, localInputRef, resolvedEmojiCommandValue, jiraSource, jiraStatusId, crossRepoSwitchTitle, crossRepoSwitchDescriptionSuffix, crossRepoSwitchFallbackLabel, selectedRepo, acceptGitHubLink, handleAddMatchingRepo, handleUseCurrentRepo, allowCrossRepoProjectAdd } = context
  return (
    <>
      {jiraSource.intent ? (
        <div id={jiraStatusId} role="status" aria-live="polite" className="flex items-center justify-between gap-2 px-1 text-xs text-muted-foreground">
          <span>{jiraStatusMessage(jiraSource)}</span>
          {jiraSource.errorKind === 'disconnected' && onOpenJiraSettings ? <Button type="button" variant="link" size="xs" onClick={onOpenJiraSettings}>{translate('auto.components.new.workspace.SmartWorkspaceNameField.openSettings', 'Settings')}</Button> : jiraSource.errorKind === 'read-failed' ? <Button type="button" variant="link" size="xs" onClick={jiraSource.retry}>{translate('auto.components.new.workspace.SmartWorkspaceNameField.retryJira', 'Retry')}</Button> : null}
        </div>
      ) : null}
      <WorkspaceEmojiSuggestionPopover
        anchorRef={localInputRef}
        open={emojiMenuOpen}
        commandValue={resolvedEmojiCommandValue}
        heading={translate('auto.components.new.workspace.SmartWorkspaceNameField.emoji', 'Emoji')}
        suggestions={emojiSuggestions}
        onCommandValueChange={setEmojiCommandValue}
        onSelect={handleEmojiSelect}
        onOpenChange={(next) => !next && setEmojiCursor(null)}
      />
      <Dialog open={crossRepoPrompt !== null} onOpenChange={(next) => !next && dismissCrossRepoPrompt()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{crossRepoSwitchTitle}</DialogTitle>
            <DialogDescription>
              {translate('auto.components.new.workspace.SmartWorkspaceNameField.ad188067ae', 'The GitHub URL points to')}{' '}
              {crossRepoPrompt?.link.slug.owner}/{crossRepoPrompt?.link.slug.repo}{crossRepoSwitchDescriptionSuffix}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={dismissCrossRepoPrompt}>{translate('auto.components.new.workspace.SmartWorkspaceNameField.6859e2896c', 'Cancel')}</Button>
            <Button variant="outline" onClick={() => void handleUseCurrentRepo()}>{translate('auto.components.new.workspace.SmartWorkspaceNameField.eadf877af5', 'Keep')} {selectedRepo?.displayName ?? crossRepoSwitchFallbackLabel}</Button>
            {crossRepoPrompt?.matchingRepo ? <Button onClick={() => void acceptGitHubLink(crossRepoPrompt.matchingRepo!)}>{translate('auto.components.new.workspace.SmartWorkspaceNameField.a76fcb4fa0', 'Switch to')} {crossRepoPrompt.matchingRepo.displayName}</Button> : allowCrossRepoProjectAdd ? <Button onClick={() => void handleAddMatchingRepo()}>{translate('auto.components.new.workspace.SmartWorkspaceNameField.e57c53727c', 'Add project...')}</Button> : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
