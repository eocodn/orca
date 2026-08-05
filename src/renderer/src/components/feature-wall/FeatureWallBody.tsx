import type { JSX } from 'react'
import type { FeatureWallWorkflow } from '../../../../shared/feature-wall-workflows'
import type { FeatureWallOpenSourceTelemetry } from '../../../../shared/telemetry-events'
import type { WorkbenchStep } from '../../../../shared/workbench-steps'
import type { ReviewStep } from '../../../../shared/review-steps'
import type { GlobalSettings } from '../../../../shared/types'
import type { InstalledAgentSkillState } from '@/hooks/useInstalledAgentSkills'
import { cn } from '@/lib/utils'
import { PreviewMedia, RelatedFeatures } from './FeatureWallPreview'
import { TasksAnimatedVisual } from './TasksAnimatedVisual'
import { WorkspacesAnimatedVisual } from './WorkspacesAnimatedVisual'
import { WorkbenchAnimatedVisual } from './WorkbenchAnimatedVisual'
import { EditorAnimatedVisual } from './EditorAnimatedVisual'
import { BrowserAnimatedVisual } from './BrowserAnimatedVisual'
import { ReviewAnimatedVisual } from './ReviewAnimatedVisual'
import { GitHubRow, LinearRow } from '../onboarding/IntegrationsStep'
import { AiCommitPrSettingsCard } from './AiCommitPrSettingsCard'
import { translate } from '@/i18n/i18n'

export function FeatureWallBody(props: {
  selected: FeatureWallWorkflow
  posterUrl: string | null
  gifUrl: string | null
  showGif: boolean
  prefersReducedMotion: boolean
  source: FeatureWallOpenSourceTelemetry
  workbenchActiveStep: WorkbenchStep | null
  reviewActiveStep: ReviewStep | null
  browserUseSkill: InstalledAgentSkillState
  settings: GlobalSettings | null
  updateSettings: (updates: Partial<GlobalSettings>) => void
}): JSX.Element {
  const {
    selected,
    posterUrl,
    gifUrl,
    showGif,
    prefersReducedMotion,
    source,
    workbenchActiveStep,
    reviewActiveStep
  } = props
  const isWorkspaces = selected.id === 'workspaces'
  const isTasks = selected.id === 'tasks'
  const isWorkbench = selected.id === 'workbench'
  const isReview = selected.id === 'review'
  const isWorkbenchEditor = isWorkbench && workbenchActiveStep?.id === 'editor'
  const isWorkbenchBrowser = isWorkbench && workbenchActiveStep?.id === 'browser'
  const isReviewPrView = isReview && reviewActiveStep?.id === 'pr-view'
  const isReviewShip = isReview && reviewActiveStep?.id === 'ship'
  const hasAnimatedVisual = isWorkspaces || isTasks || isWorkbench || isReview
  const isOnboardingWorkbenchBrowser = isWorkbenchBrowser && source === 'onboarding'
  const isReviewSettingStep = isReviewPrView || isReviewShip
  const animatedVisualWidth = isWorkspaces
    ? 'w-[440px]'
    : isWorkbenchEditor
      ? 'w-[600px]'
      : isWorkbenchBrowser
        ? isOnboardingWorkbenchBrowser
          ? 'w-[460px]'
          : 'w-[480px]'
        : isWorkbench
          ? 'w-[560px]'
          : isReview
            ? 'w-[480px]'
            : 'w-[520px]'
  const settingWidth = isTasks
    ? 'max-w-[760px]'
    : isReviewSettingStep
      ? 'max-w-[420px]'
      : isWorkbenchBrowser
        ? isOnboardingWorkbenchBrowser
          ? 'max-w-[340px]'
          : 'max-w-[400px]'
        : 'max-w-[480px]'
  const settingContent = isTasks ? (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
      <LinearRow compact />
      <GitHubRow compact />
    </div>
  ) : isWorkbenchBrowser ? (
    null
  ) : isReviewPrView ? (
    <GitHubRow compact />
  ) : isReviewShip ? (
    <AiCommitPrSettingsCard />
  ) : null
  const shouldUseOnboardingTourZones =
    source === 'onboarding' && hasAnimatedVisual && Boolean(settingContent)
  const visualStageHeight = isTasks
    ? 'h-[288px]'
    : isWorkbenchEditor
      ? 'h-[390px]'
      : isWorkbenchBrowser
        ? 'h-[270px]'
        : isWorkbench
          ? 'h-[340px]'
          : isReview
            ? 'h-[416px]'
            : 'h-[330px]'
  const animatedVisual = isWorkspaces ? (
    <WorkspacesAnimatedVisual reducedMotion={prefersReducedMotion} />
  ) : isTasks ? (
    <TasksAnimatedVisual reducedMotion={prefersReducedMotion} />
  ) : isReview && reviewActiveStep ? (
    <ReviewAnimatedVisual reducedMotion={prefersReducedMotion} activeStepId={reviewActiveStep.id} />
  ) : isWorkbench ? (
    workbenchActiveStep?.id === 'editor' ? (
      <EditorAnimatedVisual reducedMotion={prefersReducedMotion} />
    ) : isWorkbenchBrowser ? (
      <BrowserAnimatedVisual reducedMotion={prefersReducedMotion} />
    ) : (
      <WorkbenchAnimatedVisual reducedMotion={prefersReducedMotion} />
    )
  ) : null
  const animatedVisualNode = (
    <div className={cn('flex w-full items-start justify-center', visualStageHeight)}>
      <div className={cn('max-w-full', animatedVisualWidth)}>{animatedVisual}</div>
    </div>
  )
  const previewVisualNode = shouldUseOnboardingTourZones ? (
    <TourZone className="items-center">{animatedVisualNode}</TourZone>
  ) : (
    animatedVisualNode
  )

  return (
    <div className="flex min-h-full flex-col gap-4 px-8 pb-0 pt-1">
      <div
        className={cn(
          'grid grid-cols-1 items-start gap-7',
          hasAnimatedVisual ? 'justify-items-center' : 'lg:grid-cols-[minmax(0,1fr)_320px]'
        )}
      >
        {!hasAnimatedVisual ? (
          <PreviewMedia
            key={selected.id}
            posterUrl={posterUrl}
            gifUrl={gifUrl}
            showGif={showGif}
            workflowTitle={selected.title}
          />
        ) : null}
        {hasAnimatedVisual ? (
          previewVisualNode
        ) : (
          <aside className="flex flex-col gap-5">
            {selected.relatedTileIds.length > 0 ? (
              <RelatedFeatures workflow={selected} source={source} />
            ) : null}
          </aside>
        )}
      </div>
      {settingContent && shouldUseOnboardingTourZones ? (
        <div className="sticky bottom-0 z-10 -mx-8 mt-auto border-t border-border bg-card/95 px-8 py-3 backdrop-blur supports-[backdrop-filter]:bg-card/85">
          <TourZone
            className={cn(
              'scrollbar-sleek mx-auto max-h-[220px] w-full gap-2 overflow-y-auto',
              settingWidth
            )}
          >
            <>
              <div className="text-center text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">
                {translate('auto.components.feature.wall.FeatureWallBody.25ec5356d6', 'Setup')}
              </div>
              {settingContent}
            </>
          </TourZone>
        </div>
      ) : settingContent ? (
        <TourZone className={cn('mx-auto w-full', settingWidth)}>{settingContent}</TourZone>
      ) : null}
    </div>
  )
}

function TourZone(props: { className?: string; children: JSX.Element | null }): JSX.Element {
  const { className, children } = props
  return <div className={cn('flex min-w-0 flex-col', className)}>{children}</div>
}
