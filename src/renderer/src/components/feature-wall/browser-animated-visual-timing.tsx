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

export const PROMPT_TEXT = 'Make Starter card stand out'

// Why: these hand-rolled tour popovers need the same dark-mode separation as
// Orca's dropdown/popover primitives while staying inside the storyboard DOM.
export const TOUR_FLOATING_SURFACE_CLASS =
  'border border-black/14 bg-[rgba(255,255,255,0.82)] text-popover-foreground shadow-[0_16px_36px_rgba(0,0,0,0.24),inset_0_1px_0_rgba(255,255,255,0.14)] backdrop-blur-2xl dark:border-white/14 dark:bg-[rgba(0,0,0,0.72)] dark:shadow-[0_20px_44px_rgba(0,0,0,0.42),inset_0_1px_0_rgba(255,255,255,0.04)]'

export const PRE_INTRO_MS = 600
export const NEWTAB_APPROACH_MS = 700
export const NEWTAB_CLICK_MS = 180
export const NEWTAB_DWELL_MS = 700
export const NEWTAB_ROW_HOVER_MS = 1050
export const NEWTAB_ROW_CLICK_MS = 220
export const TAB_REVEAL_MS = 500
export const APPROACH_CARD_MS = 900
export const INSPECT_MS = 700
export const ANNOTATE_OPEN_MS = 360
export const ANNOTATE_TYPE_INTERVAL_MS = 58
export const ANNOTATE_HOLD_MS = 900
export const SEND_APPROACH_MS = 500
export const SEND_CLICK_MS = 250
export const HANDOFF_MS = 200
export const WORKING_LINE_STAGGER_MS = 260
export const WORKING_HOLD_MS = 1400
export const UPDATED_HOLD_MS = 900
export const VERIFY_INTENT_MS = 1100
export const CLICK_APPROACH_MS = 620
export const CLICK_PRESS_MS = 280
export const NAVIGATED_HOLD_MS = 700
export const SCREENSHOT_LINE_HOLD_MS = 420
export const SCREENSHOT_FLASH_HOLD_MS = 700
export const VERIFIED_HOLD_MS = 2400
export const RESET_HOLD_MS = 300
export const CLICK_RING_MS = 460

export type Phase =
  | 'idle'
  | 'newtab-approach'
  | 'newtab-click'
  | 'newtab-row-approach'
  | 'newtab-row-click'
  | 'tab-revealed'
  | 'approach-card'
  | 'inspect'
  | 'annotate'
  | 'send-approach'
  | 'send-click'
  | 'handoff'
  | 'working'
  | 'updated'
  | 'verify-intent'
  | 'click-approach'
  | 'click-press'
  | 'navigated'
  | 'screenshot-line'
  | 'screenshot-flash'
  | 'verified'

export const PHASE_ORDER: readonly Phase[] = [
  'idle',
  'newtab-approach',
  'newtab-click',
  'newtab-row-approach',
  'newtab-row-click',
  'tab-revealed',
  'approach-card',
  'inspect',
  'annotate',
  'send-approach',
  'send-click',
  'handoff',
  'working',
  'updated',
  'verify-intent',
  'click-approach',
  'click-press',
  'navigated',
  'screenshot-line',
  'screenshot-flash',
  'verified'
]

export function phaseAtLeast(current: Phase, target: Phase): boolean {
  return PHASE_ORDER.indexOf(current) >= PHASE_ORDER.indexOf(target)
}

export const SPLIT_PHASES: readonly Phase[] = [
  'working',
  'updated',
  'verify-intent',
  'click-approach',
  'click-press',
  'navigated',
  'screenshot-line',
  'screenshot-flash',
  'verified'
]

export function isSplitPhase(phase: Phase): boolean {
  return SPLIT_PHASES.includes(phase)
}

export type TermEntry =
  | { kind: 'prompt'; text: string }
  | { kind: 'working' }
  | { kind: 'ok'; html: ReactNode }
  | { kind: 'tool'; tool: string; arg: string }
  | { kind: 'tool-muted'; tool: string; muted: string }

export const TERM_ENTRIES: readonly { entry: TermEntry; minPhase: Phase }[] = [
  { entry: { kind: 'prompt', text: PROMPT_TEXT }, minPhase: 'working' },
  { entry: { kind: 'working' }, minPhase: 'working' },
  {
    entry: {
      kind: 'ok',
      get html() {
        return (
          <>
            {translate(
              'auto.components.feature.wall.BrowserAnimatedVisual.4fa59ca545',
              '✓ Updated'
            )}{' '}
            <code className="text-emerald-600 dark:text-emerald-400">
              {translate(
                'auto.components.feature.wall.BrowserAnimatedVisual.051c97d15a',
                '.pp-card[data-card="starter"] .pp-cta'
              )}
            </code>
          </>
        )
      }
    },
    minPhase: 'updated'
  },
  {
    entry: {
      kind: 'prompt',
      text: 'Let me click Try free to verify it still works.'
    },
    minPhase: 'verify-intent'
  },
  { entry: { kind: 'tool', tool: 'click', arg: '"Try free"' }, minPhase: 'click-press' },
  {
    entry: { kind: 'tool-muted', tool: 'screenshot', muted: '(capturing page)' },
    minPhase: 'screenshot-line'
  },
  {
    entry: {
      kind: 'ok',
      get html() {
        return (
          <>
            {translate(
              'auto.components.feature.wall.BrowserAnimatedVisual.eb88125c6f',
              '✓ Verified — Try free still works.'
            )}
          </>
        )
      }
    },
    minPhase: 'verified'
  }
]
