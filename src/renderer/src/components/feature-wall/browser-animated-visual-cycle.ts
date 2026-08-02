
import { useEffect, useRef, useState } from 'react'
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

type BrowserAnimatedVisualCycleOptions = {
  reducedMotion: boolean
  onCycleComplete?: () => void
}

export function useBrowserAnimatedVisualCycle({
  reducedMotion,
  onCycleComplete
}: BrowserAnimatedVisualCycleOptions) {
const [phase, setPhase] = useState<Phase>('idle')
const [typedChars, setTypedChars] = useState(0)
const [flashKey, setFlashKey] = useState(0)
const [clickRingKey, setClickRingKey] = useState(0)
const [clickRingVisible, setClickRingVisible] = useState(false)
const [menuOffsetX, setMenuOffsetX] = useState(0)
const [annotateAnchor, setAnnotateAnchor] = useState<{ left: number; top: number }>({
  left: 116,
  top: 70
})

const browserPageRef = useRef<HTMLDivElement | null>(null)
const titlebarRef = useRef<HTMLDivElement | null>(null)
const newtabBtnRef = useRef<HTMLSpanElement | null>(null)
const newtabRowRef = useRef<HTMLDivElement | null>(null)
const starterCardRef = useRef<HTMLDivElement | null>(null)
const ctaRef = useRef<HTMLSpanElement | null>(null)
const sendBtnRef = useRef<HTMLSpanElement | null>(null)
const cursorPosRef = useRef<{ x: number; y: number }>({ x: 40, y: 18 })
const [cursorPos, setCursorPos] = useState<{ x: number; y: number }>({ x: 40, y: 18 })

// Why: cursor coordinates are computed against .browser-page so they survive
// grid reflow when the split lands. We stash both a ref (synchronous read
// for hover-then-click sequences) and state (for transition animation).
function setCursorTo(x: number, y: number): void {
  cursorPosRef.current = { x, y }
  setCursorPos({ x, y })
}

function transformForElement(
  el: HTMLElement | null,
  offsetX = 0,
  offsetY = 0
): { x: number; y: number } {
  const page = browserPageRef.current
  if (!page || !el) {
    return cursorPosRef.current
  }
  const pageRect = page.getBoundingClientRect()
  const elRect = el.getBoundingClientRect()
  return {
    x: elRect.left - pageRect.left + elRect.width / 2 - 8 + offsetX,
    y: elRect.top - pageRect.top + elRect.height / 2 - 8 + offsetY
  }
}

/* oxlint-disable react-doctor/no-adjust-state-on-prop-change -- Why: this
   storyboard effect owns timed local animation state; deriving every phase
   during render would break measured cursor sequencing. */
useEffect(() => {
  if (reducedMotion) {
    setPhase('verified')
    setTypedChars(PROMPT_TEXT.length)
    setClickRingVisible(false)
    return
  }
  let cancelled = false
  const timeouts: number[] = []
  const wait = (ms: number): Promise<void> =>
    new Promise((resolve) => {
      const id = window.setTimeout(() => resolve(), ms)
      timeouts.push(id)
    })
  function pulseClickRing(): void {
    setClickRingKey((key) => key + 1)
    setClickRingVisible(true)
    const id = window.setTimeout(() => {
      if (!cancelled) {
        setClickRingVisible(false)
      }
    }, CLICK_RING_MS)
    timeouts.push(id)
  }

  async function loop(): Promise<void> {
    while (!cancelled) {
      setPhase('idle')
      setTypedChars(0)
      setClickRingVisible(false)
      setCursorTo(40, 18)
      await wait(PRE_INTRO_MS)
      if (cancelled) {
        return
      }

      // 1. Cursor approaches the "+" in the tab strip.
      const newtabPos = transformForElement(newtabBtnRef.current)
      setCursorTo(newtabPos.x, newtabPos.y)
      setPhase('newtab-approach')
      await wait(NEWTAB_APPROACH_MS)
      if (cancelled) {
        return
      }

      // 2. Click "+". Capture the dropdown's left offset relative to the
      // titlebar so the menu lines up with the button.
      setPhase('newtab-click')
      pulseClickRing()
      if (titlebarRef.current && newtabBtnRef.current) {
        const tbRect = titlebarRef.current.getBoundingClientRect()
        const btnRect = newtabBtnRef.current.getBoundingClientRect()
        setMenuOffsetX(btnRect.left - tbRect.left)
      }
      await wait(NEWTAB_CLICK_MS)
      if (cancelled) {
        return
      }
      await wait(NEWTAB_DWELL_MS)
      if (cancelled) {
        return
      }

      // 3. Move to "New Browser Tab" row.
      const rowPos = transformForElement(newtabRowRef.current, 6, 0)
      setCursorTo(rowPos.x, rowPos.y)
      setPhase('newtab-row-approach')
      await wait(NEWTAB_ROW_HOVER_MS)
      if (cancelled) {
        return
      }

      // 4. Click → dropdown closes, browser tab reveals, page comes alive.
      setPhase('newtab-row-click')
      pulseClickRing()
      await wait(NEWTAB_ROW_CLICK_MS)
      if (cancelled) {
        return
      }
      setPhase('tab-revealed')
      await wait(TAB_REVEAL_MS)
      if (cancelled) {
        return
      }

      // Cursor approaches the Starter card.
      const starterPos = transformForElement(starterCardRef.current, 0, -8)
      setCursorTo(starterPos.x, starterPos.y)
      setPhase('approach-card')
      await wait(APPROACH_CARD_MS)
      if (cancelled) {
        return
      }

      setPhase('inspect')
      pulseClickRing()
      await wait(INSPECT_MS)
      if (cancelled) {
        return
      }

      // Anchor the annotate popover to the Starter card's actual position so
      // it lines up regardless of how the parent grid lays out.
      if (browserPageRef.current && starterCardRef.current) {
        const pageRect = browserPageRef.current.getBoundingClientRect()
        const cardRect = starterCardRef.current.getBoundingClientRect()
        setAnnotateAnchor({
          left: cardRect.right - pageRect.left + 6,
          top: cardRect.top - pageRect.top
        })
      }
      setPhase('annotate')
      await wait(ANNOTATE_OPEN_MS)
      if (cancelled) {
        return
      }
      for (let i = 1; i <= PROMPT_TEXT.length; i += 1) {
        if (cancelled) {
          return
        }
        setTypedChars(i)
        await wait(ANNOTATE_TYPE_INTERVAL_MS)
      }
      await wait(ANNOTATE_HOLD_MS)
      if (cancelled) {
        return
      }

      const sendPos = transformForElement(sendBtnRef.current)
      setCursorTo(sendPos.x, sendPos.y)
      setPhase('send-approach')
      await wait(SEND_APPROACH_MS)
      if (cancelled) {
        return
      }

      setPhase('send-click')
      pulseClickRing()
      await wait(SEND_CLICK_MS)
      if (cancelled) {
        return
      }

      setPhase('handoff')
      await wait(HANDOFF_MS)
      if (cancelled) {
        return
      }

      // Split lands. Working line + prompt are gated on phase >= 'working';
      // small stagger keeps them from popping in simultaneously.
      setPhase('working')
      await wait(WORKING_LINE_STAGGER_MS * 2)
      if (cancelled) {
        return
      }
      await wait(WORKING_HOLD_MS)
      if (cancelled) {
        return
      }

      setPhase('updated')
      await wait(UPDATED_HOLD_MS)
      if (cancelled) {
        return
      }

      setPhase('verify-intent')
      await wait(VERIFY_INTENT_MS)
      if (cancelled) {
        return
      }

      const ctaPos = transformForElement(ctaRef.current)
      setCursorTo(ctaPos.x, ctaPos.y)
      setPhase('click-approach')
      await wait(CLICK_APPROACH_MS)
      if (cancelled) {
        return
      }

      setPhase('click-press')
      pulseClickRing()
      await wait(CLICK_PRESS_MS)
      if (cancelled) {
        return
      }

      setPhase('navigated')
      await wait(NAVIGATED_HOLD_MS)
      if (cancelled) {
        return
      }

      setPhase('screenshot-line')
      await wait(SCREENSHOT_LINE_HOLD_MS)
      if (cancelled) {
        return
      }

      setPhase('screenshot-flash')
      setFlashKey((k) => k + 1)
      await wait(SCREENSHOT_FLASH_HOLD_MS)
      if (cancelled) {
        return
      }

      setPhase('verified')
      await wait(VERIFIED_HOLD_MS)
      if (cancelled) {
        return
      }
      onCycleComplete?.()

      await wait(RESET_HOLD_MS)
    }
  }

  loop()
  return () => {
    cancelled = true
    timeouts.forEach((id) => window.clearTimeout(id))
  }
}, [onCycleComplete, reducedMotion])
/* oxlint-enable react-doctor/no-adjust-state-on-prop-change */


  return {
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
  }
}
