import { AGENTS, AUTOMATIONS_CHANGED_EVENT, DEFAULT_TIME, buildDraftPrecheck, buildHermesCronSchedule, formatExternalDate, formatTimeInput, getAgentLabel, getAutomationHostTargetFromKey, getAutomationHostTargetKey, getAutomationRunContent, getDefaultWorktree, getExternalAutomationKey, getExternalAutomationSourceKey, getExternalProviderLabel, getExternalRunContent, getExternalRunStatusLabel, getExternalRunStatusVariant, getExternalTargetKindLabel, getRepoBackedAutomationSourceContext, getRuntimeSourceHostAvailability, isMissingExternalRunsApiError, parseDraftTime, type AutomationPaneTab, type ExternalAutomationListEntry, type RepoBackedAutomationSourceContext, type SelectedExternalRunPage } from './automations-page-model'; import { waitForAutomationRerunPendingVisibility } from './automations-page-actions';  import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'; import { CalendarClock, Check, Clock, Eye, Pause, Pencil, Play, Plus, RefreshCw, Trash2, X } from 'lucide-react'; import { toast } from 'sonner'; import { filterEnabledTuiAgents, isTuiAgentEnabled } from '../../../../shared/tui-agent-selection'; import type { Badge } from '@/components/ui/badge'; import { Button } from '@/components/ui/button'; import { installWindowVisibilityInterval } from '@/lib/window-visibility-interval'; import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from '@/components/ui/context-menu'; import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'; import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'; import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'; import { useAppStore } from '@/store'; import { callRuntimeRpc } from '@/runtime/runtime-rpc-client'; import { getLocalPreflightContext, localPreflightContextKey } from '@/lib/local-preflight-context'; import { cn } from '@/lib/utils'; import RepoBadgeLabel from '@/components/repo/RepoBadgeLabel'; import { getAgentCatalog } from '@/lib/agent-catalog'; import { useRepoMap, useWorktreeMap } from '@/store/selectors'; import { activateAndRevealWorktree } from '@/lib/worktree-activation'; import type { Automation, ExternalAutomationAction, ExternalAutomationJob, ExternalAutomationManager, ExternalAutomationRun, AutomationPrecheck, AutomationRun, AutomationUpdateInput } from '../../../../shared/automations-types'; import { getAutomationRunRepoId } from '../../../../shared/automation-run-identity'; import { getLocalExecutionHostLabel, getRepoExecutionHostId, parseExecutionHostId } from '../../../../shared/execution-host'; import { getHostDisplayLabelOverrides } from '../../../../shared/host-setting-overrides'; import { TASK_SOURCE_CONTEXT_RUNTIME_CAPABILITY } from '../../../../shared/protocol-version'; import type { PreflightStatus } from '../../../../preload/api-types'; import type { RuntimeStatus } from '../../../../shared/runtime-types'; import type { TaskSourceContext } from '../../../../shared/task-source-context'; import type { OrcaHooks, Repo, Worktree } from '../../../../shared/types'; import { getWorktreePathBasenameFromId } from '../../../../shared/worktree-id'; import { buildAutomationCronSchedule, buildAutomationRrule, formatAutomationSchedule, isValidAutomationCronSchedule, isValidAutomationSchedule, tryParseAutomationRrule } from '../../../../shared/automation-schedules'; import { formatAutomationDateTimeWithRelative, getAutomationRunStatusLabel, getAutomationRunStatusVariant } from './automation-page-parts'; import { formatAutomationCost, formatAutomationTokens, summarizeAutomationRunUsage } from './automation-usage-model'; import { canRerunAutomationRun, getAutomationRunViewState } from './automation-run-view-state'; import { automationRunMatchesPaneKey, buildAutomationRunOpenLayout, canOpenAutomationRunOpenTarget, getAutomationRunOpenTabId, resolveAutomationRunOpenTarget } from './automation-run-open-target'; import { getAutomationRunWorkspaceDisplay } from './automation-run-workspace-display'; import CommentMarkdown from '@/components/sidebar/CommentMarkdown'; import { AutomationDetail } from './AutomationDetail'; import { HermesCronOutputView } from './HermesCronOutputView'; import { AutomationEditorDialog, type AutomationCreateTarget, type AutomationDraft } from './AutomationEditorDialog'; import { AutomationRunPageFrame } from './AutomationRunPageFrame'; import { AutomationRunHistory } from './AutomationRunHistory'; import { getAutomationSetupDecisionDraftValue, getVisibleAutomationSetupDecision, resolveAutomationSetupDecisionForSave } from './automation-setup-decision'; import { getAutomationTemplates, type AutomationTemplate } from './automation-templates'; import { getAutomationTargetAvailability } from './automation-target-availability'; import { buildAutomationRunContextForRepo } from './automation-run-context'; import { ensureHooksConfirmed } from '@/lib/ensure-hooks-confirmed'; import { getSettingsForRepoRuntimeOwner } from '@/lib/repo-runtime-owner'; import { checkRuntimeHooks } from '@/runtime/runtime-hooks-client'; import { getRepoBackedProviderAvailability, type RuntimeProviderPreflightStatus } from '../task-source-provider-availability'; import type { TaskSourceHostAvailability } from '../task-source-context-summary'; import { getExternalAutomationActionDisabledMessage, getExternalAutomationSourceAvailability, isSshConnectionBusy } from './external-automation-source-availability'; import { createAutomationForTarget, deleteAutomationForTarget, type AutomationHostTarget, getAutomationListTarget, getAutomationOwnerTarget, getAutomationTargetFromHostId, listAutomationRunsForTarget, listAutomationsForTarget, runAutomationNowForTarget, updateAutomationForTarget } from './automation-host-client'; import { getExternalAutomationScheduleDisplay } from './external-automation-schedule-display'; import { ExternalAutomationManagers } from './ExternalAutomationManagers'; import type { FetchExternalAutomationRuns } from './ExternalAutomationRunTable'; import { useContextualTour } from '@/components/contextual-tours/use-contextual-tour'; import { translate } from '@/i18n/i18n';
export function AutomationsPageRenderer(props: Record<string, unknown>): React.JSX.Element { const { activePaneTab, applyTemplateToDraft, automationHostTarget, automationSourceHostAvailabilityById, automationYamlHooksByRepoKey, automations, canRerunSelectedAutomationRunPage, canSaveDraft, closeAutomationsPage, confirmDeleteAutomation, confirmDeleteExternalAutomation, connectExternalAutomationSource, createOpen, createTarget, deleteConfirmButtonRef, deleteTarget, dontAskDeleteAgain, draft, editingAutomationId, editingExternalTarget, externalActionKey, externalAutomationEntries, externalDeleteTarget, fetchExternalAutomationRuns, getAutomationHooksCacheKey, getAutomationRepoHostLabel, handleCreateTargetChange, handleProjectChange, hostLabelById, isLoading, isSaving, isSelectedAutomationRunPageRerunPending, markSetupDecisionTouched, openAutomationRunPage, openCreateDialog, openEditDialog, openEditExternalDialog, openExternalRunPage, openRunWorkspace, projectHostSetups, refresh, relativeNow, repoMap, repos, requestDeleteAutomation, requestExternalAction, rerunAutomationRun, runNow, runs, runtimeStatusByEnvironmentId, saveAutomation, selectAutomationId, selectExternalKey, selected, selectedAutomationRunPage, selectedAutomationRunPageViewState, selectedAutomationRunPageWorkspaceDisplay, selectedExternal, selectedExternalRunPage, selectedExternalSourceAvailability, selectedExternalSshConnected, selectedExternalSshSource, selectedRepo, selectedRunNowAvailability, selectedRuns, selectedWorktree, setActivePaneTab, setCreateOpen, setDeleteTarget, setDontAskDeleteAgain, setDraft, setExternalDeleteTarget, setSelectedAutomationRunPageId, setSelectedExternalRunPage, settings, sshConnectionStates, toggleAutomation, worktreeMap, worktrees } = props as any; return ( <main className="relative flex h-full min-h-0 flex-col bg-background text-foreground">
<header className="flex shrink-0 items-center justify-between px-5 pb-3 pt-1.5 md:px-8">
<div className="flex items-center gap-2">
<Tooltip>
<TooltipTrigger asChild>
<Button
variant="ghost"
size="icon"
className="size-7 rounded-full"
onClick={closeAutomationsPage}
aria-label={translate(
'auto.components.automations.AutomationsPage.67c7ff795b',
'Close automations'
)} > <X className="size-4" />
</Button>
</TooltipTrigger>
<TooltipContent side="bottom" sideOffset={6}>
{translate('auto.components.automations.AutomationsPage.0329f9bef1', 'Close · Esc')}
</TooltipContent>
</Tooltip>
<div className="mx-1 h-5 w-px bg-border/50" aria-hidden />
<CalendarClock className="size-4 text-muted-foreground" />
<h1 className="text-sm font-semibold">
{translate('auto.components.automations.AutomationsPage.77c2778945', 'Automations')}
</h1>
<Tooltip>
<TooltipTrigger asChild>
<Button
variant="ghost"
size="icon-sm"
aria-label={translate(
'auto.components.automations.AutomationsPage.8d1afa8269',
'Add automation'
)} onClick={() => openCreateDialog()} className="border border-border/50 bg-transparent hover:bg-muted/50" data-contextual-tour-target="automations-create" > <Plus className="size-4" />
</Button>
</TooltipTrigger>
<TooltipContent side="bottom" sideOffset={6}>
{translate(
'auto.components.automations.AutomationsPage.8d1afa8269',
'Add automation'
)} </TooltipContent>
</Tooltip>
</div>
<div className="flex items-center gap-2">
<Tooltip>
<TooltipTrigger asChild>
<Button
variant="ghost"
size="icon-sm"
aria-label={translate(
'auto.components.automations.AutomationsPage.19a6e30eae',
'Refresh automations'
)} onClick={refresh} disabled={isLoading} className="border border-border/50 bg-transparent hover:bg-muted/50" > <RefreshCw className={cn('size-4', isLoading && 'animate-spin')} />
</Button>
</TooltipTrigger>
<TooltipContent side="bottom" sideOffset={6}>
{translate(
'auto.components.automations.AutomationsPage.19a6e30eae',
'Refresh automations'
)} </TooltipContent>
</Tooltip>
</div>
</header>
<AutomationEditorDialog
open={createOpen}
isEditing={editingAutomationId !== null}
isSaving={isSaving}
canSave={canSaveDraft}
isEditingExternal={editingExternalTarget !== null}
createTarget={createTarget}
repos={repos}
projectHostSetups={projectHostSetups}
automationYamlHooksByRepoKey={automationYamlHooksByRepoKey}
getAutomationHooksCacheKey={getAutomationHooksCacheKey}
repoMap={repoMap}
worktrees={worktrees}
settings={settings}
draft={draft}
onProjectChange={handleProjectChange}
getRepoHostLabel={getAutomationRepoHostLabel}
onCreateTargetChange={handleCreateTargetChange}
onOpenChange={setCreateOpen}
onDraftChange={setDraft}
onSetupDecisionTouched={markSetupDecisionTouched}
onApplyTemplate={applyTemplateToDraft}
onSave={() => void saveAutomation()}
/>
<Dialog
open={deleteTarget !== null}
onOpenChange={(open) => {
if (open) {
return
}; setDeleteTarget(null); setDontAskDeleteAgain(false) }} > <DialogContent
className="max-w-md"
onOpenAutoFocus={(event) => {
event.preventDefault()
deleteConfirmButtonRef.current?.focus()
}} > <DialogHeader>
<DialogTitle className="text-sm">
{translate(
'auto.components.automations.AutomationsPage.080dcb5fbb',
'Delete Automation'
)} </DialogTitle>
<DialogDescription className="text-xs">
{translate('auto.components.automations.AutomationsPage.15e0bfb13b', 'Delete')}{' '}
<span className="break-all font-medium text-foreground">{deleteTarget?.name}</span>{' '}
{translate(
'auto.components.automations.AutomationsPage.b264564427',
'and its run history. Workspaces created by previous runs are not deleted.'
)} </DialogDescription>
</DialogHeader>
{deleteTarget ? (
<div className="rounded-md border border-border/70 bg-muted/35 px-3 py-2 text-xs">
<div className="break-all font-medium text-foreground">{deleteTarget.name}</div>
<div className="mt-1 text-muted-foreground">
{deleteTarget.workspaceMode === 'new_per_run'
? translate(
'auto.components.automations.AutomationsPage.cd8397cc32',
'New workspace each run'
) : translate( 'auto.components.automations.AutomationsPage.36f71740a7', 'Selected workspace' )} </div>
</div>
) : null} <button
type="button"
role="checkbox"
aria-checked={dontAskDeleteAgain}
onClick={() => setDontAskDeleteAgain((prev) => !prev)}
className="flex items-center gap-2 rounded-sm px-1 py-1 text-xs text-foreground/80 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
>
<span
className={`flex size-4 items-center justify-center rounded-sm border transition-colors ${
dontAskDeleteAgain
? 'border-foreground bg-foreground text-background'
: 'border-muted-foreground bg-transparent'
}`} > {dontAskDeleteAgain ? <Check className="size-3" strokeWidth={3} /> : null} </span>
{translate('auto.components.automations.AutomationsPage.1e2e41392f', "Don't ask again")}
</button>
<DialogFooter>
<Button
variant="outline"
onClick={() => {
setDeleteTarget(null)
setDontAskDeleteAgain(false)
}} > {translate('auto.components.automations.AutomationsPage.73f630b49d', 'Cancel')} </Button>
<Button
ref={deleteConfirmButtonRef}
variant="destructive"
onClick={() => void confirmDeleteAutomation()}
>
<Trash2 className="size-4" />
{translate('auto.components.automations.AutomationsPage.15e0bfb13b', 'Delete')}
</Button>
</DialogFooter>
</DialogContent>
</Dialog>
<Dialog
open={externalDeleteTarget !== null}
onOpenChange={(open) => {
if (!open) {
setExternalDeleteTarget(null)
} }} > <DialogContent
className="max-w-md"
onOpenAutoFocus={(event) => {
event.preventDefault()
deleteConfirmButtonRef.current?.focus()
}} > <DialogHeader>
<DialogTitle className="text-sm">
{translate(
'auto.components.automations.AutomationsPage.9adfab2596',
'Delete External Automation'
)} </DialogTitle>
<DialogDescription className="text-xs">
{translate('auto.components.automations.AutomationsPage.15e0bfb13b', 'Delete')}{' '}
<span className="break-all font-medium text-foreground">
{externalDeleteTarget?.job.name}
</span>{' '}
{translate('auto.components.automations.AutomationsPage.02a33e3204', 'from')}{' '}
{externalDeleteTarget
? getExternalProviderLabel(externalDeleteTarget.manager)
: translate(
'auto.components.automations.AutomationsPage.8500baacb4',
'external source'
)}{' '} {translate('auto.components.automations.AutomationsPage.1b586f0e2b', 'on')} {externalDeleteTarget?.manager.targetLabel}. </DialogDescription>
</DialogHeader>
{externalDeleteTarget ? (
<div className="rounded-md border border-border/70 bg-muted/35 px-3 py-2 text-xs">
<div className="break-all font-medium text-foreground">
{externalDeleteTarget.job.name}
</div>
<div className="mt-1 text-muted-foreground">
{
getExternalAutomationScheduleDisplay(
externalDeleteTarget.manager,
externalDeleteTarget.job
).label } </div>
</div>
) : null} <DialogFooter>
<Button variant="outline" onClick={() => setExternalDeleteTarget(null)}>
{translate('auto.components.automations.AutomationsPage.73f630b49d', 'Cancel')}
</Button>
<Button
ref={deleteConfirmButtonRef}
variant="destructive"
onClick={() => void confirmDeleteExternalAutomation()}
>
<Trash2 className="size-4" />
{translate('auto.components.automations.AutomationsPage.15e0bfb13b', 'Delete')}
</Button>
</DialogFooter>
</DialogContent>
</Dialog>
<div className="grid min-h-0 flex-1 grid-cols-[minmax(280px,360px)_1fr] overflow-hidden border-t border-border/50">
<section
className="flex min-h-0 flex-col border-r border-border/50 bg-muted/20"
data-contextual-tour-target="automations-list"
>
<div className="scrollbar-sleek min-h-0 flex-1 overflow-auto p-2">
{automations.length + externalAutomationEntries.length > 0 ? (
<div className="grid grid-cols-[1fr_auto] gap-2 px-2 pb-2 text-[11px] font-medium uppercase text-muted-foreground">
<span>
{translate(
'auto.components.automations.AutomationsPage.761a35834d',
'Automation'
)} </span>
<span>
{translate('auto.components.automations.AutomationsPage.587a4b205c', 'Next')}
</span>
</div>
) : null} {automations.map((automation) => {; const automationRepo = repoMap.get(getAutomationRunRepoId(automation)); const automationWorktree = automation.workspaceId ? worktreeMap.get(automation.workspaceId) : null; const automationRunAvailability = getAutomationTargetAvailability({ automation, repo: automationRepo, workspace: automationWorktree, projectHostSetups, sshConnectionStates, runtimeStatusByEnvironmentId, automationHostTarget, sourceHostAvailability: automationSourceHostAvailabilityById.get(automation.id) }); const workspaceLabel = automation.workspaceMode === 'new_per_run' ? `Create from ${automation.baseBranch ?? automationRepo?.worktreeBaseRef ?? 'project default'}` : (automationWorktree?.displayName ?? 'Missing workspace'); const usageSummary = summarizeAutomationRunUsage( runs.filter((run) => run.automationId === automation.id) ); const usageText = usageSummary.knownRuns > 0 ? `${formatAutomationCost(
usageSummary.estimatedCostUsd
)} est. · ${formatAutomationTokens(usageSummary.totalTokens)} tokens` : usageSummary.unavailableRuns > 0 ? 'Usage unavailable' : 'No run usage yet'; const nextRunLabel = automation.enabled ? formatAutomationDateTimeWithRelative(automation.nextRunAt, relativeNow) : 'Paused'; const scheduleLabel = formatAutomationSchedule(automation.rrule); return ( <ContextMenu key={automation.id}>
<ContextMenuTrigger asChild>
<button
type="button"
onClick={() => {
selectExternalKey(null)
selectAutomationId(automation.id)
}} className={cn( 'mb-1 grid w-full grid-cols-[minmax(0,1fr)_auto] gap-3 rounded-md border px-3 py-2 text-left text-sm transition-colors', selectedExternal === null && selected?.id === automation.id ? 'border-foreground/30 bg-muted/70 text-foreground shadow-sm' : 'border-transparent hover:bg-muted/50' )} > <span className="min-w-0">
<span className="flex min-w-0 items-center gap-2">
<span
className={cn(
'size-2 rounded-full',
automation.enabled ? 'bg-foreground' : 'bg-muted-foreground/40'
)} /> <span className="truncate font-medium">{automation.name}</span>
</span>
<span className="mt-1 block truncate text-xs font-medium text-foreground/80">
{scheduleLabel}
</span>
<span className="mt-1 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
{automationRepo ? (
<RepoBadgeLabel
name={automationRepo.displayName}
color={automationRepo.badgeColor}
badgeClassName="size-1.5"
/>
) : ( <span>
{translate(
'auto.components.automations.AutomationsPage.13118faadf',
'Unknown project'
)} </span>
)} <span className="shrink-0">/</span>
<span className="truncate">{workspaceLabel}</span>
<span className="shrink-0">·</span>
<span className="truncate">{getAgentLabel(automation.agentId)}</span>
</span>
<span className="mt-1 block truncate text-xs text-muted-foreground">
{usageText}
</span>
</span>
<span className="flex max-w-28 flex-col items-end gap-1 text-right text-xs text-muted-foreground">
<Clock className="size-3.5" />
<span className="line-clamp-2">{nextRunLabel}</span>
</span>
</button>
</ContextMenuTrigger>
<ContextMenuContent className="w-48">
<ContextMenuItem
disabled={!automationRunAvailability.canRunNow}
onSelect={(event) => {
if (!automationRunAvailability.canRunNow) {
event.preventDefault()
return
} void runNow(automation) }} > <Play className="size-3.5" />
<span className="min-w-0 truncate">
{automationRunAvailability.canRunNow
? translate(
'auto.components.automations.AutomationsPage.2faecab10b',
'Run Now'
) : automationRunAvailability.message} </span>
</ContextMenuItem>
<ContextMenuItem onSelect={() => void openEditDialog(automation)}>
<Pencil className="size-3.5" />
{translate('auto.components.automations.AutomationsPage.f4612e3f78', 'Edit')}
</ContextMenuItem>
<ContextMenuItem onSelect={() => void toggleAutomation(automation)}>
{automation.enabled ? (
<Pause className="size-3.5" />
) : ( <Play className="size-3.5" />
)} {automation.enabled ? translate( 'auto.components.automations.AutomationsPage.b457436d6a', 'Pause' ) : translate( 'auto.components.automations.AutomationsPage.376631ef2b', 'Resume' )} </ContextMenuItem>
<ContextMenuSeparator />
<ContextMenuItem
variant="destructive"
onSelect={() => requestDeleteAutomation(automation)}
>
<Trash2 className="size-3.5" />
{translate(
'auto.components.automations.AutomationsPage.15e0bfb13b',
'Delete'
)} </ContextMenuItem>
</ContextMenuContent>
</ContextMenu>
) })} {externalAutomationEntries.map((entry) => {; const providerLabel = getExternalProviderLabel(entry.manager); const targetKindLabel = getExternalTargetKindLabel(entry.manager); if (entry.kind === 'source') {; const sshStatus = entry.manager.target.type === 'ssh' ? sshConnectionStates.get(entry.manager.target.connectionId)?.status : undefined; const sourceAvailability = getExternalAutomationSourceAvailability({ manager: entry.manager, providerLabel, targetKindLabel, sshStatus }); return ( <button
key={entry.key}
type="button"
onClick={() => {
selectExternalKey(entry.key)
setActivePaneTab('overview')
}} className={cn( 'mb-1 grid w-full grid-cols-[minmax(0,1fr)_auto] gap-3 rounded-md border px-3 py-2 text-left text-sm transition-colors', selectedExternal?.key === entry.key ? 'border-foreground/30 bg-muted/70 text-foreground shadow-sm' : 'border-transparent hover:bg-muted/50' )} > <span className="min-w-0">
<span className="flex min-w-0 items-center gap-2">
<span className="size-2 rounded-full bg-muted-foreground/40" />
<span className="truncate font-medium">{entry.manager.targetLabel}</span>
</span>
<span className="mt-1 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
<span>
{providerLabel}{' '}
{translate(
'auto.components.automations.AutomationsPage.82eb6cb933',
'source'
)} </span>
<span className="shrink-0">/</span>
<span className="truncate">{targetKindLabel}</span>
</span>
<span className="mt-1 block truncate text-xs text-muted-foreground">
{sourceAvailability.summary}
</span>
</span>
<span className="flex max-w-28 flex-col items-end gap-1 text-right text-xs text-muted-foreground">
<Clock className="size-3.5" />
<span className="line-clamp-2">{sourceAvailability.statusLabel}</span>
</span>
</button>
) }; const nextRunLabel = entry.job.enabled ? formatExternalDate(entry.job.nextRunAt, relativeNow) : 'Paused'; const entrySshStatus = entry.manager.target.type === 'ssh' ? sshConnectionStates.get(entry.manager.target.connectionId)?.status : undefined; const disabledMessage = getExternalAutomationActionDisabledMessage({ manager: entry.manager, providerLabel, targetKindLabel, sshStatus: entrySshStatus, actionInProgress: externalActionKey !== null }); const actionDisabled = disabledMessage !== null; const scheduleDisplay = getExternalAutomationScheduleDisplay(entry.manager, entry.job); return ( <ContextMenu key={entry.key}>
<ContextMenuTrigger asChild>
<button
type="button"
onClick={() => {
selectExternalKey(entry.key)
setActivePaneTab('overview')
}} className={cn( 'mb-1 grid w-full grid-cols-[minmax(0,1fr)_auto] gap-3 rounded-md border px-3 py-2 text-left text-sm transition-colors', selectedExternal?.key === entry.key ? 'border-foreground/30 bg-muted/70 text-foreground shadow-sm' : 'border-transparent hover:bg-muted/50' )} > <span className="min-w-0">
<span className="flex min-w-0 items-center gap-2">
<span
className={cn(
'size-2 rounded-full',
entry.job.enabled ? 'bg-foreground' : 'bg-muted-foreground/40'
)} /> <span className="truncate font-medium">{entry.job.name}</span>
</span>
<span className="mt-1 block truncate text-xs font-medium text-foreground/80">
{scheduleDisplay.label}
</span>
<span className="mt-1 flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
<span className="truncate">
{providerLabel} / {entry.manager.targetLabel}
</span>
<span className="shrink-0">·</span>
<span className="truncate">
{entry.manager.provider === 'hermes'
? `${entry.job.runCount} ${entry.job.runCount === 1 ? 'run' : 'runs'}`
: entry.manager.canManage
? translate(
'auto.components.automations.AutomationsPage.aecdc3681f',
'Manageable'
) : translate( 'auto.components.automations.AutomationsPage.e059042585', 'Read-only' )} </span>
</span>
</span>
<span className="flex max-w-28 flex-col items-end gap-1 text-right text-xs text-muted-foreground">
<Clock className="size-3.5" />
<span className="line-clamp-2">{nextRunLabel}</span>
</span>
</button>
</ContextMenuTrigger>
<ContextMenuContent className="w-48">
<ContextMenuItem
disabled={actionDisabled}
onSelect={() => requestExternalAction(entry.manager, entry.job, 'run')}
>
<Play className="size-3.5" />
<span className="min-w-0 truncate">
{disabledMessage ??
translate(
'auto.components.automations.AutomationsPage.2faecab10b',
'Run Now'
)} </span>
</ContextMenuItem>
{entry.manager.provider === 'hermes' ? (
<ContextMenuItem
disabled={!entry.manager.canManage || externalActionKey !== null}
onSelect={() => openEditExternalDialog(entry.manager, entry.job)}
>
<Pencil className="size-3.5" />
{translate(
'auto.components.automations.AutomationsPage.f4612e3f78',
'Edit'
)} </ContextMenuItem>
) : null} <ContextMenuItem
disabled={actionDisabled}
onSelect={() =>
requestExternalAction(
entry.manager,
entry.job,
entry.job.enabled ? 'pause' : 'resume'
) } > {entry.job.enabled ? ( <Pause className="size-3.5" />
) : ( <Play className="size-3.5" />
)} {entry.job.enabled ? translate( 'auto.components.automations.AutomationsPage.b457436d6a', 'Pause' ) : translate( 'auto.components.automations.AutomationsPage.376631ef2b', 'Resume' )} </ContextMenuItem>
<ContextMenuSeparator />
<ContextMenuItem
variant="destructive"
disabled={actionDisabled}
onSelect={() => requestExternalAction(entry.manager, entry.job, 'delete')}
>
<Trash2 className="size-3.5" />
{translate(
'auto.components.automations.AutomationsPage.15e0bfb13b',
'Delete'
)} </ContextMenuItem>
</ContextMenuContent>
</ContextMenu>
) })} {automations.length === 0 && externalAutomationEntries.length === 0 ? ( <div className="grid gap-2 p-2">
<div className="px-1 pb-1 text-sm font-medium">
{translate(
'auto.components.automations.AutomationsPage.d207ab4c25',
'Start from a template'
)} </div>
{getAutomationTemplates().map((template) => (
<button
key={template.id}
type="button"
onClick={() => openCreateDialog(template)}
className="rounded-md border border-border/70 bg-background px-3 py-2 text-left shadow-xs transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
>
<div className="text-[11px] font-medium uppercase text-muted-foreground">
{template.category}
</div>
<div className="mt-1 text-sm font-medium">{template.label}</div>
<div className="mt-1 line-clamp-2 text-xs text-muted-foreground">
{template.description}
</div>
</button>
))} <Button
type="button"
variant="outline"
className="mt-1 w-full justify-start"
onClick={() => openCreateDialog()}
>
<Plus className="size-4" />
{translate('auto.components.automations.AutomationsPage.25060635c6', 'Add new')}
</Button>
</div>
) : null} </div>
</section>
<section className="flex min-h-0 flex-col overflow-hidden">
{selectedExternal ? (
<div className="scrollbar-sleek min-h-0 overflow-auto p-5">
{selectedExternalRunPage ? (
<AutomationRunPageFrame
title={selectedExternalRunPage.job.name}
breadcrumbs={[
formatExternalDate(selectedExternalRunPage.run.runAt, relativeNow),
getExternalProviderLabel(selectedExternalRunPage.manager),
selectedExternalRunPage.manager.targetLabel
]}
detail={selectedExternalRunPage.run.outputPath}
statusLabel={getExternalRunStatusLabel(selectedExternalRunPage.run)}
statusVariant={getExternalRunStatusVariant(selectedExternalRunPage.run)}
onBack={() => setSelectedExternalRunPage(null)}
>
<HermesCronOutputView
content={getExternalRunContent(selectedExternalRunPage.run)}
/>
</AutomationRunPageFrame>
) : selectedExternal.kind === 'job' ? ( <ExternalAutomationManagers
managers={[
{
...selectedExternal.manager,
jobs: [selectedExternal.job]
} ]} now={relativeNow} runningActionKey={externalActionKey} onAction={requestExternalAction} onFetchRuns={fetchExternalAutomationRuns} onOpenRun={openExternalRunPage} onEdit={openEditExternalDialog} /> ) : ( <div className="rounded-md border border-border/50 bg-muted/20 shadow-sm">
<div className="flex items-center justify-between border-b border-border/50 px-3 py-2">
<div className="min-w-0">
<div className="truncate text-sm font-medium">
{selectedExternal.manager.targetLabel}
</div>
<div className="text-xs text-muted-foreground">
{selectedExternalSourceAvailability?.summary}
</div>
</div>
{selectedExternalSshSource ? (
<Button
type="button"
variant="outline"
size="sm"
disabled={selectedExternalSourceAvailability?.isConnecting ?? false}
onClick={() =>
void connectExternalAutomationSource(selectedExternalSshSource.manager)
} > {selectedExternalSourceAvailability?.isConnecting ? ( <RefreshCw className="size-3.5 animate-spin" />
) : null} {selectedExternalSourceAvailability?.isConnecting ? translate( 'auto.components.automations.AutomationsPage.f93ed7a6f8', 'Connecting...' ) : selectedExternalSshConnected ? translate( 'auto.components.automations.AutomationsPage.53f06f0ad5', 'Retry source' ) : translate( 'auto.components.automations.AutomationsPage.7934ee0d81', 'Connect SSH' )} </Button>
) : null} </div>
<div className="px-3 py-6 text-sm text-muted-foreground">
{selectedExternalSourceAvailability?.detail}
</div>
</div>
)} </div>
) : ( <Tabs
value={activePaneTab}
onValueChange={(value) => setActivePaneTab(value as AutomationPaneTab)}
className="min-h-0 flex-1 gap-0"
>
<div
className="flex shrink-0 items-center justify-between border-b border-border/50 px-5 py-2"
data-contextual-tour-target="automations-runs"
>
<TabsList variant="line" className="h-8">
<TabsTrigger value="overview">
{translate(
'auto.components.automations.AutomationsPage.bb1b2cd31e',
'Overview'
)} </TabsTrigger>
<TabsTrigger value="runs" disabled={!selected}>
{translate('auto.components.automations.AutomationsPage.0e110a3469', 'Runs')}{' '}
<span className="text-xs text-muted-foreground">{selectedRuns.length}</span>
</TabsTrigger>
</TabsList>
</div>
<TabsContent value="overview" className="scrollbar-sleek min-h-0 overflow-auto p-5">
<AutomationDetail
automation={selected}
runs={selectedRuns}
projectName={selectedRepo?.displayName ?? 'Unknown project'}
projectDefaultBaseRef={selectedRepo?.worktreeBaseRef ?? null}
workspaceName={
selected?.workspaceMode === 'new_per_run'
? 'New workspace each run'
: (selectedWorktree?.displayName ?? 'Missing workspace')
} hostLabelById={hostLabelById} runNowAvailability={selectedRunNowAvailability} now={relativeNow} onRunNow={(automation) => void runNow(automation)} onEdit={(automation) => void openEditDialog(automation)} onToggle={(automation) => void toggleAutomation(automation)} onDelete={requestDeleteAutomation} /> </TabsContent>
<TabsContent value="runs" className="scrollbar-sleek min-h-0 overflow-auto p-5">
{selectedAutomationRunPage ? (
<AutomationRunPageFrame
title={selected?.name ?? selectedAutomationRunPage.title}
breadcrumbs={[
formatAutomationDateTimeWithRelative(
selectedAutomationRunPage.scheduledFor,
relativeNow
), 'Orca', selectedAutomationRunPageWorkspaceDisplay?.detailLabel ?? 'No workspace' ]} detail={ selectedAutomationRunPage.outputSnapshot?.truncated ? 'Latest saved output' : null } statusLabel={getAutomationRunStatusLabel(selectedAutomationRunPage.status)} statusVariant={getAutomationRunStatusVariant(selectedAutomationRunPage.status)} actions={ <>
{canRerunSelectedAutomationRunPage && selected ? (
<Button
type="button"
variant="outline"
size="sm"
disabled={isSelectedAutomationRunPageRerunPending}
onClick={() =>
void rerunAutomationRun(selected, selectedAutomationRunPage)
} > <RefreshCw
className={cn(
'size-3.5',
isSelectedAutomationRunPageRerunPending && 'animate-spin'
)} /> {translate( 'auto.components.automations.AutomationsPage.295698292f', 'Rerun' )} </Button>
) : null} {selectedAutomationRunPageViewState ? ( <Button
type="button"
variant="outline"
size="sm"
disabled={!selectedAutomationRunPageViewState.canOpen}
onClick={() => openRunWorkspace(selectedAutomationRunPage)}
>
<Eye className="size-3.5" />
{selectedAutomationRunPageViewState.actionLabel}
</Button>
) : null} </>
} onBack={() => setSelectedAutomationRunPageId(null)} > <CommentMarkdown
variant="document"
content={getAutomationRunContent(selectedAutomationRunPage)}
className="text-sm leading-relaxed text-foreground"
/>
</AutomationRunPageFrame>
) : selected ? ( <AutomationRunHistory
runs={selectedRuns}
automationId={selected.id}
worktreeMap={worktreeMap}
onOpenRun={openAutomationRunPage}
/>
) : ( <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
{translate(
'auto.components.automations.AutomationsPage.c3a28c9793',
'Select an automation to view runs.'
)} </div>
)} </TabsContent>
</Tabs>
)} </section>
</div>
</main>
) 
}