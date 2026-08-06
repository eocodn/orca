/* The public facade keeps the feature-wall import stable; this module owns the storyboard surface. */
import { useEffect, useRef, useState, type JSX, type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { ClaudeIcon } from '@/lib/agent-icon-glyphs'
import { useShortcutLabel } from '@/hooks/useShortcutLabel'
import { FeatureWallClickRing } from './FeatureWallClickRing'
import { translate } from '@/i18n/i18n'

// Why: this animation tells the full Orca story end-to-end — the user opens a
// new browser tab, annotates a target on the pricing page, types a change,
// hands off to Claude in a split pane, and Claude edits + verifies the page.
// The DOM and timing track docs/feature-wall-workbench-tile-mock.html so the
// modal stays in lockstep with the design source.

import type { TermEntry } from './browser-animated-visual-timing'

export function BrowserTab(props: {
  icon: ReactNode
  title: string
  minimized?: boolean
  incoming?: boolean
}): JSX.Element {
  const { icon, title, minimized, incoming } = props
  return (
    <span
      className={cn(
        'relative inline-flex shrink-0 items-center gap-1.5 rounded-t-md border border-b-0 border-border bg-card px-2.5 pb-1.5 pt-1 text-[11px] text-foreground',
        minimized ? 'gap-0 px-2' : null,
        incoming ? 'animate-[browserTabIn_320ms_cubic-bezier(.2,.8,.2,1)_both]' : null
      )}
      style={{ top: 1 }}
    >
      <span className="inline-flex size-3 items-center justify-center text-muted-foreground">
        {icon}
      </span>
      {minimized ? null : (
        <span className="whitespace-nowrap text-[11px] text-foreground">{title}</span>
      )}
    </span>
  )
}

export function DropdownSkeletonRow(props: { widthPct: number }): JSX.Element {
  return (
    <div
      className="grid items-center gap-2 rounded-md px-2 py-[5px]"
      style={{ gridTemplateColumns: '18px 1fr' }}
    >
      <span className="size-[13px] rounded-[3px] bg-popover-foreground/10" />
      <span
        className="h-[7px] rounded-[3px] bg-popover-foreground/10"
        style={{ width: `${props.widthPct}%` }}
      />
    </div>
  )
}

export function TermEntryView(props: { entry: TermEntry }): JSX.Element {
  const { entry } = props
  if (entry.kind === 'prompt') {
    return (
      <span className="text-card-foreground">
        <span className="text-muted-foreground">
          {translate('auto.components.feature.wall.BrowserAnimatedVisual.f2034c4930', '>')}
        </span>{' '}
        {entry.text}
      </span>
    )
  }
  if (entry.kind === 'working') {
    return (
      <span className="inline-flex items-center gap-1.5 text-muted-foreground">
        <span className="size-1.5 animate-pulse rounded-full bg-emerald-500 dark:bg-emerald-400" />
        {translate('auto.components.feature.wall.BrowserAnimatedVisual.0ce7c24b4d', 'Working…')}
      </span>
    )
  }
  if (entry.kind === 'ok') {
    return <span className="text-emerald-600 dark:text-emerald-400">{entry.html}</span>
  }
  if (entry.kind === 'tool') {
    return (
      <span>
        <span className="text-violet-600 dark:text-violet-400">{entry.tool}</span>{' '}
        <span className="text-emerald-600 dark:text-emerald-400">{entry.arg}</span>
      </span>
    )
  }
  return (
    <span>
      <span className="text-violet-600 dark:text-violet-400">{entry.tool}</span>{' '}
      <span className="text-muted-foreground">{entry.muted}</span>
    </span>
  )
}

export function TerminalLine(props: { visible: boolean; children: ReactNode }): JSX.Element {
  return (
    <span
      className={cn('transition-opacity duration-300', props.visible ? 'opacity-100' : 'opacity-0')}
    >
      {props.children}
    </span>
  )
}

export function PricingView(props: {
  cardRef: React.RefObject<HTMLDivElement | null>
  ctaRef: React.RefObject<HTMLSpanElement | null>
  ringStarter: boolean
  ctaHighlighted: boolean
  ctaPressing: boolean
}): JSX.Element {
  return (
    <>
      <div className="text-[15px] font-bold leading-tight">
        {translate('auto.components.feature.wall.BrowserAnimatedVisual.9e0f530390', 'Pricing')}
      </div>
      <div className="h-2 w-4/5 rounded bg-foreground/10" />
      <div className="mt-1 grid grid-cols-2 gap-2.5">
        <PricingCard
          cardRef={props.cardRef}
          ctaRef={props.ctaRef}
          label={translate(
            'auto.components.feature.wall.BrowserAnimatedVisual.59ae327405',
            'Starter'
          )}
          cta="Try free"
          target
          ringActive={props.ringStarter}
          ctaHighlighted={props.ctaHighlighted}
          ctaPressing={props.ctaPressing}
        />
        <PricingCard
          label={translate('auto.components.feature.wall.BrowserAnimatedVisual.25f15c2219', 'Pro')}
          cta="Get Pro"
          highlighted
        />
      </div>
    </>
  )
}

export function SignupView(): JSX.Element {
  return (
    <div className="flex animate-[browserViewIn_360ms_cubic-bezier(.2,.8,.2,1)_both] flex-col gap-3">
      <div className="text-[15px] font-bold leading-tight">
        {translate(
          'auto.components.feature.wall.BrowserAnimatedVisual.46df009982',
          'Start your free trial'
        )}
      </div>
      <div className="h-2 w-[70%] rounded bg-foreground/10" />
      <div className="-mt-1 h-2 w-[55%] rounded bg-foreground/10" />
    </div>
  )
}

export function PricingCard(props: {
  label: string
  cta: string
  highlighted?: boolean
  target?: boolean
  ringActive?: boolean
  ctaHighlighted?: boolean
  ctaPressing?: boolean
  cardRef?: React.RefObject<HTMLDivElement | null>
  ctaRef?: React.RefObject<HTMLSpanElement | null>
}): JSX.Element {
  const {
    label,
    cta,
    highlighted,
    target,
    ringActive,
    ctaHighlighted,
    ctaPressing,
    cardRef,
    ctaRef
  } = props
  const ctaIsBranded = ctaHighlighted && !highlighted
  return (
    <div
      ref={cardRef}
      className="relative flex flex-col gap-1.5 rounded-md border border-border bg-card p-2.5"
    >
      {target ? (
        <span
          aria-hidden
          className={cn(
            'pointer-events-none absolute -inset-[3px] rounded-[10px] border-2 border-blue-500 bg-blue-500/10 transition-opacity duration-300',
            ringActive ? 'opacity-100' : 'opacity-0'
          )}
        />
      ) : null}
      <span className="text-[11.5px] font-semibold">{label}</span>
      <div className="h-1.5 w-3/5 rounded bg-foreground/10" />
      <div className="h-1.5 w-4/5 rounded bg-foreground/10" />
      <span
        ref={ctaRef}
        className={cn(
          'mt-1 inline-flex w-fit items-center rounded-md px-2 py-1 text-[11px] font-semibold transition-[background-color,color,box-shadow,transform] duration-300',
          highlighted
            ? 'bg-foreground text-background'
            : ctaIsBranded
              ? 'bg-blue-600 text-white shadow-[0_6px_16px_rgba(37,99,235,0.35)]'
              : 'bg-foreground/[0.07] text-foreground',
          ctaPressing ? 'scale-[0.96]' : null
        )}
      >
        {cta}
      </span>
    </div>
  )
}

export function NavGlyph(props: { children: ReactNode }): JSX.Element {
  return (
    <span className="inline-flex size-[18px] items-center justify-center rounded text-muted-foreground">
      {props.children}
    </span>
  )
}

export function PlusGlyph(): JSX.Element {
  return (
    <svg
      width={12}
      height={12}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      aria-hidden
    >
      <path d="M8 3v10M3 8h10" />
    </svg>
  )
}

export function TerminalGlyph(): JSX.Element {
  return (
    <svg
      width={12}
      height={12}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.4}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="m4 6 2.5 2L4 10" />
      <path d="M8.5 11h3.5" />
    </svg>
  )
}

export function GlobeGlyph(): JSX.Element {
  return (
    <svg
      width={12}
      height={12}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.4}
      aria-hidden
    >
      <circle cx={8} cy={8} r={5.5} />
      <path d="M2.5 8h11M8 2.5c2 1.7 2 9.3 0 11M8 2.5c-2 1.7-2 9.3 0 11" />
    </svg>
  )
}

export function CursorIcon(): JSX.Element {
  return (
    <svg
      width={16}
      height={16}
      viewBox="0 0 16 16"
      aria-hidden
      focusable="false"
      className="drop-shadow-[0_1px_1px_rgba(0,0,0,0.35)]"
    >
      <path
        d="M2 1.5 L2 12 L5 9 L7.2 14.5 L9.5 13.6 L7.3 8 L11.5 8 Z"
        fill="#fff"
        stroke="#18181b"
        strokeWidth={1}
        strokeLinejoin="round"
      />
    </svg>
  )
}
