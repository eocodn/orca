/* The public facade keeps the feature-wall import stable; this module owns the storyboard surface. */
import { type JSX, type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { useBrowserAnimatedVisualCycle } from './browser-animated-visual-cycle'
import { ClaudeIcon } from '@/components/status-bar/icons'
import { useShortcutLabel } from '@/hooks/useShortcutLabel'
import { FeatureWallClickRing } from './FeatureWallClickRing'
import { translate } from '@/i18n/i18n'

// Why: this animation tells the full Orca story end-to-end — the user opens a
// new browser tab, annotates a target on the pricing page, types a change,
// hands off to Claude in a split pane, and Claude edits + verifies the page.
// The DOM and timing track docs/feature-wall-workbench-tile-mock.html so the
// modal stays in lockstep with the design source.

import {
  PROMPT_TEXT,
  TOUR_FLOATING_SURFACE_CLASS,
  PRE_INTRO_MS,
  NEWTAB_APPROACH_MS,
  NEWTAB_CLICK_MS,
  NEWTAB_DWELL_MS,
  NEWTAB_ROW_HOVER_MS,
  NEWTAB_ROW_CLICK_MS,
  TAB_REVEAL_MS,
  APPROACH_CARD_MS,
  INSPECT_MS,
  ANNOTATE_OPEN_MS,
  ANNOTATE_TYPE_INTERVAL_MS,
  ANNOTATE_HOLD_MS,
  SEND_APPROACH_MS,
  SEND_CLICK_MS,
  HANDOFF_MS,
  WORKING_LINE_STAGGER_MS,
  WORKING_HOLD_MS,
  UPDATED_HOLD_MS,
  VERIFY_INTENT_MS,
  CLICK_APPROACH_MS,
  CLICK_PRESS_MS,
  NAVIGATED_HOLD_MS,
  SCREENSHOT_LINE_HOLD_MS,
  SCREENSHOT_FLASH_HOLD_MS,
  VERIFIED_HOLD_MS,
  RESET_HOLD_MS,
  CLICK_RING_MS,
  Phase,
  PHASE_ORDER,
  phaseAtLeast,
  SPLIT_PHASES,
  isSplitPhase,
  TermEntry,
  TERM_ENTRIES,
} from './browser-animated-visual-timing'

import {
  BrowserTab,
  DropdownSkeletonRow,
  TermEntryView,
  TerminalLine,
  PricingView,
  SignupView,
  PricingCard,
  NavGlyph,
  PlusGlyph,
  TerminalGlyph,
  GlobeGlyph,
  CursorIcon,
} from './browser-animated-visual-elements'

export function BrowserAnimatedVisual(props: {
  reducedMotion: boolean
  onCycleComplete?: () => void
}): JSX.Element {
  const { reducedMotion, onCycleComplete } = props
  const newBrowserShortcutLabel = useShortcutLabel('tab.newBrowser')

  const {
    phase,
    typedChars,
    flashKey,
    clickRingKey,
    clickRingVisible,
    menuOffsetX,
    annotateAnchor,
    browserPageRef,
    titlebarRef,
    newtabBtnRef,
    newtabRowRef,
    starterCardRef,
    ctaRef,
    sendBtnRef,
    cursorPos
  } = useBrowserAnimatedVisualCycle({ reducedMotion, onCycleComplete })

  const isIntroPhase =
    phase === 'idle' ||
    phase === 'newtab-approach' ||
    phase === 'newtab-click' ||
    phase === 'newtab-row-approach' ||
    phase === 'newtab-row-click'
  const browserChromeVisible = !isIntroPhase
  const browserTabVisible = !isIntroPhase
  const terminalTabMinimized = !isIntroPhase
  const newtabActive = phase === 'newtab-click' || phase === 'newtab-row-approach'
  const newtabRowActive = phase === 'newtab-row-approach'
  const dropdownVisible =
    phase === 'newtab-click' || phase === 'newtab-row-approach' || phase === 'newtab-row-click'
  const cursorVisible = (phase !== 'idle' && phase !== 'navigated') || clickRingVisible
  const ringStarter =
    phase === 'inspect' ||
    phase === 'annotate' ||
    phase === 'send-approach' ||
    phase === 'send-click' ||
    phase === 'handoff'
  const annotateOpen = phase === 'annotate' || phase === 'send-approach' || phase === 'send-click'
  const sendPressed = phase === 'send-click'
  const isSplit = isSplitPhase(phase)
  const ctaHighlighted = phaseAtLeast(phase, 'updated')
  const ctaPressing = phase === 'click-press'
  const showSignup =
    phase === 'navigated' ||
    phase === 'screenshot-line' ||
    phase === 'screenshot-flash' ||
    phase === 'verified'
  const flashing = phase === 'screenshot-flash'
  // While the cursor is acting on the titlebar / dropdown, let the cursor
  // overflow the body's clipping bounds. Once the page is live we re-clip so
  // the cursor never escapes the browser body.
  const bodyOverflowVisible = isIntroPhase

  return (
    <div className="flex flex-col gap-2">
      <div className="relative w-full" style={{ height: 270 }}>
        <div
          className="absolute inset-0 grid transition-[grid-template-columns,gap] duration-500 ease-out"
          style={{
            gridTemplateColumns: isSplit ? '1fr 1fr' : '1fr 0fr',
            gap: isSplit ? 10 : 0
          }}
        >
          {/* Browser app-window — column 1 */}
          <div className="relative flex min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-card text-card-foreground shadow-xs">
            <div
              ref={titlebarRef}
              className="relative flex min-h-[32px] items-end gap-1.5 border-b border-border bg-muted/40 px-2.5 pt-2"
            >
              <div className="ml-1 flex flex-1 items-end gap-1 overflow-visible">
                <BrowserTab
                  minimized={terminalTabMinimized}
                  icon={<TerminalGlyph />}
                  title={translate(
                    'auto.components.feature.wall.BrowserAnimatedVisual.04096318ab',
                    'Terminal 1'
                  )}
                />
                {browserTabVisible ? (
                  <BrowserTab
                    incoming
                    icon={<GlobeGlyph />}
                    title={translate(
                      'auto.components.feature.wall.BrowserAnimatedVisual.7da6eed7bf',
                      'localhost:3000'
                    )}
                  />
                ) : null}
                <span
                  ref={newtabBtnRef}
                  className={cn(
                    'mb-1 inline-flex size-[22px] items-center justify-center rounded-md text-muted-foreground transition-colors duration-150',
                    newtabActive ? 'bg-foreground/10 text-foreground' : null
                  )}
                >
                  <PlusGlyph />
                </span>
              </div>
              {/* New-tab dropdown menu */}
              <div
                aria-hidden={!dropdownVisible}
                className={cn(
                  'absolute z-40 origin-top-left rounded-[10px] p-1 text-[11.5px] transition-[opacity,transform] duration-150',
                  TOUR_FLOATING_SURFACE_CLASS,
                  dropdownVisible
                    ? 'translate-y-0 scale-100 opacity-100'
                    : '-translate-y-[3px] scale-[0.985] opacity-0'
                )}
                style={{
                  top: 'calc(100% + 4px)',
                  left: menuOffsetX,
                  minWidth: 196
                }}
              >
                <DropdownSkeletonRow widthPct={64} />
                <div
                  ref={newtabRowRef}
                  className={cn(
                    'grid items-center gap-2 rounded-md px-2 py-[5px]',
                    newtabRowActive ? 'bg-black/8 dark:bg-white/14' : null
                  )}
                  style={{ gridTemplateColumns: '18px 1fr' }}
                >
                  <span className="inline-flex size-[13px] items-center justify-center text-popover-foreground">
                    <GlobeGlyph />
                  </span>
                  <span className="text-[11.5px] text-popover-foreground">
                    {translate(
                      'auto.components.feature.wall.BrowserAnimatedVisual.0a2bd01c02',
                      'New Browser Tab'
                    )}
                  </span>
                  <span className="font-mono text-[10.5px] text-muted-foreground">
                    {newBrowserShortcutLabel}
                  </span>
                </div>
                <DropdownSkeletonRow widthPct={52} />
              </div>
            </div>

            {/* URL toolbar — hidden until tab reveals so the panel reads as
                "tab created → page came alive" instead of a static frame. */}
            <div
              className="flex items-center gap-2 border-b border-border bg-muted/20 px-2.5 py-1.5"
              style={{ visibility: browserChromeVisible ? 'visible' : 'hidden' }}
            >
              <span className="inline-flex gap-1 text-muted-foreground">
                <NavGlyph>‹</NavGlyph>
                <NavGlyph>›</NavGlyph>
                <NavGlyph>↻</NavGlyph>
              </span>
              <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden rounded-md border border-border bg-card px-2 py-[3px] font-mono text-[11px]">
                {isSplit ? (
                  <span className="truncate text-muted-foreground transition-colors duration-200">
                    {`...${showSignup ? '/signup' : '/pricing'}`}
                  </span>
                ) : (
                  <>
                    <span className="truncate text-foreground">
                      {translate(
                        'auto.components.feature.wall.BrowserAnimatedVisual.7da6eed7bf',
                        'localhost:3000'
                      )}
                    </span>
                    <span className="truncate text-muted-foreground transition-colors duration-200">
                      {showSignup
                        ? translate(
                            'auto.components.feature.wall.BrowserAnimatedVisual.f39be6ca14',
                            '/signup'
                          )
                        : translate(
                            'auto.components.feature.wall.BrowserAnimatedVisual.73bbb46073',
                            '/pricing'
                          )}
                    </span>
                  </>
                )}
              </div>
            </div>

            {/* Browser body — relative + overflow-{hidden|visible} so the
                cursor can escape during the new-tab intro to reach the
                titlebar's "+" / dropdown rows. */}
            <div
              className="relative flex-1 bg-card"
              style={{
                overflow: bodyOverflowVisible ? 'visible' : 'hidden',
                minHeight: 0
              }}
            >
              <div
                ref={browserPageRef}
                className="relative flex flex-col gap-3 px-5 py-4"
                style={{ visibility: browserChromeVisible ? 'visible' : 'hidden' }}
              >
                {showSignup ? (
                  <SignupView />
                ) : (
                  <PricingView
                    cardRef={starterCardRef}
                    ctaRef={ctaRef}
                    ringStarter={ringStarter}
                    ctaHighlighted={ctaHighlighted}
                    ctaPressing={ctaPressing}
                  />
                )}

                <div
                  aria-hidden={!annotateOpen}
                  className={cn(
                    'pointer-events-none absolute z-30 flex origin-top-left flex-col gap-1.5 rounded-md px-[9px] pb-[7px] pt-2 text-[10px] transition-[opacity,transform] duration-200',
                    TOUR_FLOATING_SURFACE_CLASS,
                    annotateOpen ? 'scale-100 opacity-100' : 'scale-[0.96] opacity-0'
                  )}
                  style={{ left: annotateAnchor.left, top: annotateAnchor.top, width: 188 }}
                >
                  <span className="block w-full shrink-0 truncate font-mono text-[9.5px] leading-none text-muted-foreground">
                    {translate(
                      'auto.components.feature.wall.BrowserAnimatedVisual.d8856b604a',
                      'div.pricing-grid > div.card.starter:nth-of-type(1) > a.cta'
                    )}
                  </span>
                  <span aria-hidden className="h-px w-full shrink-0 bg-popover-foreground/10" />
                  <div className="min-h-[28px] flex-1 break-words font-sans text-[10px] leading-[1.35] text-popover-foreground">
                    {typedChars > 0 ? (
                      <>
                        {PROMPT_TEXT.slice(0, typedChars)}
                        <span className="ml-px inline-block h-2 w-px translate-y-[1px] bg-popover-foreground align-baseline" />
                      </>
                    ) : (
                      <span className="text-muted-foreground">
                        {translate(
                          'auto.components.feature.wall.BrowserAnimatedVisual.3d2352f94b',
                          'Describe the change…'
                        )}
                      </span>
                    )}
                  </div>
                  <div className="flex justify-end">
                    <span
                      ref={sendBtnRef}
                      aria-label={translate(
                        'auto.components.feature.wall.BrowserAnimatedVisual.0f8481e1a7',
                        'Send to Claude'
                      )}
                      className={cn(
                        'inline-flex size-5 shrink-0 items-center justify-center rounded border border-border bg-muted text-foreground transition-[background-color,transform] duration-150',
                        sendPressed ? 'scale-[0.92] bg-foreground/[0.12]' : null
                      )}
                    >
                      <ClaudeIcon size={12} />
                    </span>
                  </div>
                </div>

                <span
                  key={flashKey}
                  aria-hidden
                  className={cn(
                    'pointer-events-none absolute inset-0 z-40 bg-background/85 dark:bg-foreground/12',
                    flashing ? 'animate-[browserFlash_360ms_ease-out_forwards]' : 'opacity-0'
                  )}
                />
              </div>
              <div
                aria-hidden
                className={cn(
                  'pointer-events-none absolute left-0 top-0 z-50 transition-[opacity,transform] duration-700 ease-[cubic-bezier(.45,.05,.2,1)]',
                  cursorVisible ? 'opacity-100' : 'opacity-0'
                )}
                style={{ transform: `translate(${cursorPos.x}px, ${cursorPos.y}px)` }}
              >
                <div className="relative">
                  <CursorIcon />
                  {clickRingVisible ? <FeatureWallClickRing key={clickRingKey} /> : null}
                </div>
              </div>
            </div>
          </div>

          <div
            className={cn(
              'flex min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-card font-mono text-[10px] text-card-foreground shadow-xs transition-[opacity,transform] duration-500',
              isSplit ? 'translate-x-0 opacity-100' : 'translate-x-2 opacity-0'
            )}
          >
            <div className="flex h-5 shrink-0 items-center gap-1.5 border-b border-border bg-muted/40 px-2 text-[9.5px] font-medium text-foreground">
              <ClaudeIcon size={11} />
              <span>
                {translate(
                  'auto.components.feature.wall.BrowserAnimatedVisual.6e4616d039',
                  'Claude'
                )}
              </span>
            </div>
            <div className="flex flex-1 flex-col gap-1 px-2 py-2 leading-snug">
              {TERM_ENTRIES.map(({ entry, minPhase }, i) => (
                <TerminalLine key={i} visible={phaseAtLeast(phase, minPhase)}>
                  <TermEntryView entry={entry} />
                </TerminalLine>
              ))}
            </div>
          </div>
        </div>
      </div>
      <style>
        {translate(
          'auto.components.feature.wall.BrowserAnimatedVisual.1bec24acc1',
          '@keyframes browserFlash { 0% { opacity: 0; } 20% { opacity: 0.85; } 100% { opacity: 0; } } @keyframes browserTabIn { from { opacity: 0; transform: translateY(-2px); } to { opacity: 1; transform: none; } } @keyframes browserViewIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }'
        )}
      </style>
    </div>
  )
}


