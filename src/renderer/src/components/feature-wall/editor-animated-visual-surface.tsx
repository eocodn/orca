// Concrete surface implementation for EditorAnimatedVisual.tsx
import { useEffect, useRef } from 'react'
import type { JSX, ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { getShortcutPlatform } from '@/hooks/useShortcutLabel'
import { translate } from '@/i18n/i18n'

// Why: the visual leans on direct DOM mutation (typing into a node, swapping
// classes, anchoring a floating menu by measured rect) so the loop reads
// like the HTML mock instead of fighting React's reconciliation.

const PRE_HOVER_MS = 450
const TYPE_PER_CHAR_MS = 60
const POST_TYPE_MS = 120
const MENU_HOLD_MS = 900
const CLICK_RIPPLE_MS = 220
const POST_CLICK_MS = 140
const POST_H1_REVEAL_MS = 260
const POST_H1_TYPE_MS = 700
const NEW_LINE_HOLD_MS = 380
const FINAL_HOLD_MS = 2200

const KBD_CLASS_DOC =
  'rounded border border-border bg-card px-1.5 py-0.5 font-mono text-[10.5px] text-muted-foreground'

import {
  CursorIcon,
  TB_ICON,
  ToolbarBtn,
  ToolbarSep,
  SlashRow,
} from './editor-animated-visual-toolbar'

import {
  DocTitle,
  DocBlock,
  ActiveLine,
  activeLineClass,
  caretClass,
  codeBlockHTML,
} from './editor-animated-visual-document'

export function EditorAnimatedVisual(props: { reducedMotion: boolean }): JSX.Element {
  const { reducedMotion } = props
  const editorShortcutPrefix = getShortcutPlatform() === 'darwin' ? '⌘' : 'Ctrl+'
  const boldShortcutLabel = `${editorShortcutPrefix}B`
  const italicShortcutLabel = `${editorShortcutPrefix}I`

  const docRef = useRef<HTMLDivElement | null>(null)
  const activeLineRef = useRef<HTMLDivElement | null>(null)
  const activeTextRef = useRef<HTMLSpanElement | null>(null)
  const afterRef = useRef<HTMLDivElement | null>(null)
  const cursorRef = useRef<HTMLDivElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const rowH1Ref = useRef<HTMLDivElement | null>(null)
  const rowCodeRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (reducedMotion) {
      return
    }
    const docMaybe = docRef.current
    const activeLineInitial = activeLineRef.current
    const cursorMaybe = cursorRef.current
    const menuMaybe = menuRef.current
    const afterMaybe = afterRef.current
    if (!docMaybe || !activeLineInitial || !cursorMaybe || !menuMaybe || !afterMaybe) {
      return
    }
    // Re-bind to non-null locals so the helper closures spanning `await`
    // points keep their narrowed types — TS flow analysis drops the narrow
    // through async boundaries otherwise.
    const doc: HTMLDivElement = docMaybe
    const cursor: HTMLDivElement = cursorMaybe
    const menu: HTMLDivElement = menuMaybe
    const after: HTMLDivElement = afterMaybe

    let cancelled = false
    const timers: number[] = []
    const wait = (ms: number): Promise<void> =>
      new Promise((resolve) => {
        const id = window.setTimeout(() => resolve(), ms)
        timers.push(id)
      })

    // Stash initial DOM so we can restore between loops.
    const initialActiveLineHTML = activeLineInitial.outerHTML
    const initialActiveLineParent = activeLineInitial.parentNode
    const initialActiveLineNextSibling = activeLineInitial.nextSibling

    let activeLine: HTMLDivElement = activeLineInitial
    let activeText: HTMLSpanElement | null = activeTextRef.current
    let activeCaret: HTMLSpanElement | null =
      activeLineInitial.querySelector<HTMLSpanElement>('[data-md-caret]')

    function setSlashMode(mode: 'all' | 'code'): void {
      menu.querySelectorAll<HTMLElement>('[data-slash-show]').forEach((el) => {
        const allowed = (el.getAttribute('data-slash-show') ?? '').split(',')
        el.style.display = allowed.includes(mode) ? '' : 'none'
      })
    }

    function placeMenuNearLine(line: HTMLElement): void {
      const docRect = doc.getBoundingClientRect()
      const lineRect = line.getBoundingClientRect()
      // Why: nudge the menu right so it doesn't cover the "/" the user just
      // typed — keeps the typed character visible alongside the menu.
      const x = lineRect.left - docRect.left + 16
      menu.style.left = `${x}px`
      menu.style.top = '0px'
      const wasShown = menu.dataset.shown === '1'
      if (!wasShown) {
        menu.style.visibility = 'hidden'
        menu.dataset.shown = '1'
        menu.style.opacity = '1'
        menu.style.transform = 'none'
      }
      const menuH = menu.getBoundingClientRect().height
      if (!wasShown) {
        menu.dataset.shown = ''
        menu.style.opacity = ''
        menu.style.transform = ''
        menu.style.visibility = ''
      }
      const belowY = lineRect.bottom - docRect.top + 6
      const aboveY = lineRect.top - docRect.top - menuH - 6
      const docH = docRect.height
      const fitsBelow = belowY + menuH <= docH - 4
      menu.style.top = `${fitsBelow ? belowY : Math.max(4, aboveY)}px`
    }

    function moveCursorTo(targetEl: HTMLElement, offsetX = 0, offsetY = 0): void {
      const docRect = doc.getBoundingClientRect()
      const tRect = targetEl.getBoundingClientRect()
      const x = tRect.left - docRect.left + offsetX
      const y = tRect.top - docRect.top + offsetY
      cursor.style.transform = `translate(${x}px, ${y}px)`
    }

    function showMenu(): void {
      menu.dataset.shown = '1'
      menu.style.opacity = '1'
      menu.style.transform = 'translateY(0) scale(1)'
    }
    function hideMenu(): void {
      menu.dataset.shown = ''
      menu.style.opacity = '0'
      menu.style.transform = 'translateY(-4px) scale(0.985)'
    }
    function clearActiveRow(): void {
      menu
        .querySelectorAll<HTMLElement>('[data-slash-row]')
        .forEach((el) => el.classList.remove('slash-active'))
    }

    async function typeInto(
      el: HTMLElement,
      text: string,
      perChar = TYPE_PER_CHAR_MS
    ): Promise<void> {
      for (const ch of text) {
        if (cancelled) {
          return
        }
        el.textContent = (el.textContent ?? '') + ch
        await wait(perChar)
      }
    }

    function clearAfter(): void {
      after.innerHTML = ''
    }

    function restoreInitialActiveLine(): void {
      // Pull whatever the active line currently is back into the original
      // shape so the next loop starts from the same DOM as render.
      activeLine.remove()
      const wrapper = document.createElement('div')
      wrapper.innerHTML = initialActiveLineHTML
      const fresh = wrapper.firstElementChild as HTMLDivElement | null
      if (!fresh) {
        return
      }
      if (initialActiveLineParent) {
        if (
          initialActiveLineNextSibling &&
          initialActiveLineNextSibling.parentNode === initialActiveLineParent
        ) {
          initialActiveLineParent.insertBefore(fresh, initialActiveLineNextSibling)
        } else {
          initialActiveLineParent.appendChild(fresh)
        }
      }
      activeLine = fresh
      activeText = fresh.querySelector<HTMLSpanElement>('[data-md-active-text]')
      activeCaret = fresh.querySelector<HTMLSpanElement>('[data-md-caret]')
    }

    async function loop(): Promise<void> {
      while (!cancelled) {
        // Reset state.
        clearAfter()
        hideMenu()
        clearActiveRow()
        cursor.style.transition = 'none'
        cursor.style.opacity = '0'
        cursor.style.transform = 'translate(-30px, 80px)'
        // Force reflow so the next transition takes effect.
        void cursor.offsetWidth
        cursor.style.transition = ''
        await wait(PRE_HOVER_MS)
        if (cancelled) {
          return
        }

        // 1. Type "/" on the fresh active line.
        if (activeText) {
          activeText.textContent = ''
        }
        await typeInto(activeText ?? activeLine, '/')
        if (cancelled) {
          return
        }
        await wait(POST_TYPE_MS)
        if (cancelled) {
          return
        }

        // 2. Slash menu opens, anchored near the line.
        setSlashMode('all')
        placeMenuNearLine(activeLine)
        showMenu()
        cursor.style.opacity = '1'
        const rowH1 = rowH1Ref.current
        if (rowH1) {
          moveCursorTo(rowH1, 14, 11)
          rowH1.classList.add('slash-active')
        }
        await wait(MENU_HOLD_MS)
        if (cancelled) {
          return
        }

        // 3. Click — line becomes an H1.
        cursor.dataset.clicking = '1'
        await wait(CLICK_RIPPLE_MS)
        if (cancelled) {
          return
        }
        cursor.dataset.clicking = ''
        hideMenu()
        cursor.style.opacity = '0'
        await wait(POST_CLICK_MS)
        if (cancelled) {
          return
        }

        // Convert the active line to an H1: clear the slash glyph, drop the
        // monospace styling, type the heading.
        activeLine.dataset.role = 'h1'
        if (activeText) {
          activeText.textContent = ''
        }
        if (activeCaret) {
          activeCaret.style.display = ''
        }
        await wait(POST_H1_REVEAL_MS)
        if (cancelled) {
          return
        }
        await typeInto(activeText ?? activeLine, 'Ship checklist', 55)
        if (cancelled) {
          return
        }
        await wait(POST_H1_TYPE_MS)
        if (cancelled) {
          return
        }

        // 4. New active line below the H1 — user types "/code".
        const newActive = document.createElement('div')
        newActive.dataset.role = 'active'
        newActive.className = activeLineClass()
        const newText = document.createElement('span')
        newText.dataset.mdActiveText = '1'
        const newCaret = document.createElement('span')
        newCaret.dataset.mdCaret = '1'
        newCaret.className = caretClass()
        newActive.appendChild(newText)
        newActive.appendChild(newCaret)
        after.appendChild(newActive)
        const lineForBeat2 = newActive
        await wait(NEW_LINE_HOLD_MS)
        if (cancelled) {
          return
        }

        for (const ch of '/code') {
          if (cancelled) {
            return
          }
          newText.textContent = (newText.textContent ?? '') + ch
          await wait(TYPE_PER_CHAR_MS)
        }
        await wait(POST_TYPE_MS)
        if (cancelled) {
          return
        }

        // Filter to the Code Block row, anchor menu, highlight.
        clearActiveRow()
        if (rowH1) {
          rowH1.classList.remove('slash-active')
        }
        setSlashMode('code')
        placeMenuNearLine(lineForBeat2)
        showMenu()
        cursor.style.opacity = '1'
        const rowCode = rowCodeRef.current
        if (rowCode) {
          moveCursorTo(rowCode, 14, 11)
          rowCode.classList.add('slash-active')
        }
        await wait(MENU_HOLD_MS)
        if (cancelled) {
          return
        }

        // 5. Click — line becomes a code block.
        cursor.dataset.clicking = '1'
        await wait(CLICK_RIPPLE_MS)
        if (cancelled) {
          return
        }
        cursor.dataset.clicking = ''
        hideMenu()
        cursor.style.opacity = '0'
        await wait(POST_CLICK_MS)
        if (cancelled) {
          return
        }

        const codeBlock = document.createElement('div')
        codeBlock.className = 'mt-1.5 animate-[md-block-in_380ms_cubic-bezier(.2,.8,.2,1)_both]'
        codeBlock.innerHTML = codeBlockHTML()
        lineForBeat2.replaceWith(codeBlock)

        await wait(FINAL_HOLD_MS)
        if (cancelled) {
          return
        }

        // Restore the initial DOM and loop.
        restoreInitialActiveLine()
      }
    }

    void loop()
    return () => {
      cancelled = true
      timers.forEach((id) => window.clearTimeout(id))
    }
  }, [reducedMotion])

  return (
    <div className="relative overflow-visible rounded-xl border border-border bg-card text-foreground shadow-[0_1px_2px_rgba(24,24,27,0.04)]">
      {/* Faux titlebar with the editing path so the surface reads as a
          real document, not a generic notes widget. */}
      <div className="flex h-7 items-center gap-1.5 border-b border-border bg-muted/40 px-3">
        <span className="size-2.5 rounded-full bg-rose-400/70" />
        <span className="size-2.5 rounded-full bg-amber-400/70" />
        <span className="size-2.5 rounded-full bg-emerald-400/70" />
        <span className="ml-2 font-mono text-[11px] text-muted-foreground">
          {translate(
            'auto.components.feature.wall.EditorAnimatedVisual.cda56c5915',
            'notes / launch-plan.md'
          )}
        </span>
      </div>

      {/* Toolbar — visual-only, mirrors RichMarkdownToolbar.tsx button order. */}
      <div className="flex items-center gap-0.5 border-b border-border bg-muted/30 px-2 py-1.5">
        <ToolbarBtn iconKey="pilcrow" />
        <ToolbarBtn iconKey="h1" />
        <ToolbarBtn iconKey="h2" />
        <ToolbarBtn iconKey="h3" />
        <ToolbarSep />
        <ToolbarBtn iconKey="bold" />
        <ToolbarBtn iconKey="italic" />
        <ToolbarBtn iconKey="strike" />
        <ToolbarSep />
        <ToolbarBtn iconKey="list" />
        <ToolbarBtn iconKey="olist" />
        <ToolbarBtn iconKey="check" />
        <ToolbarBtn iconKey="quote" />
        <span className="ml-auto inline-flex items-center gap-1.5 font-mono text-[10px] text-muted-foreground">
          <span className="size-1.5 rounded-full bg-emerald-500" />
          <span>
            {translate('auto.components.feature.wall.EditorAnimatedVisual.218503f9f3', 'autosaved')}
          </span>
        </span>
      </div>

      {/* Document surface. Height is driven by the modal's right-column
          width, so we leave it intrinsic and rely on the inner layout. */}
      <div
        ref={docRef}
        className="relative overflow-hidden bg-background px-6 pb-5 pt-4"
        style={{ minHeight: 280 }}
      >
        <DocTitle>
          {translate('auto.components.feature.wall.EditorAnimatedVisual.5a55c00a81', 'Launch plan')}
        </DocTitle>

        <DocBlock>
          {translate(
            'auto.components.feature.wall.EditorAnimatedVisual.22ae7b4d9d',
            "A quick note for the team — pulling together what's left before we ship."
          )}
        </DocBlock>

        <DocBlock listItem>
          {translate(
            'auto.components.feature.wall.EditorAnimatedVisual.95f0c3a46f',
            'Smoke-test the install flow on a fresh machine.'
          )}
        </DocBlock>
        <DocBlock listItem>
          {translate(
            'auto.components.feature.wall.EditorAnimatedVisual.4426aab46f',
            'Update the docs index once the new tile lands.'
          )}
        </DocBlock>

        {/* Active line where the slash menu fires. The animation imperatively
            mutates this node — typing a glyph, swapping role to h1, etc. */}
        <ActiveLine activeLineRef={activeLineRef} activeTextRef={activeTextRef} />

        <div ref={afterRef} />

        {/* Slash menu, absolutely-positioned and anchored at runtime. */}
        <div
          ref={menuRef}
          data-slash-menu
          className="pointer-events-none absolute z-10 min-w-[220px] origin-top-left rounded-lg border border-border bg-card p-1.5 text-[12px] shadow-[0_16px_38px_rgba(24,24,27,0.18),0_2px_6px_rgba(24,24,27,0.08)] transition-[opacity,transform] duration-[160ms] ease-out"
          style={{
            opacity: 0,
            transform: 'translateY(-4px) scale(0.985)'
          }}
        >
          <div
            data-slash-show="all"
            className="px-2 pb-1 pt-1.5 text-[9.5px] font-bold uppercase tracking-[0.06em] text-muted-foreground"
          >
            {translate('auto.components.feature.wall.EditorAnimatedVisual.1fb29ad710', 'Headings')}
          </div>
          <SlashRow
            refCb={(el) => {
              rowH1Ref.current = el
            }}
            iconKey="h1"
            label={translate(
              'auto.components.feature.wall.EditorAnimatedVisual.722170663a',
              'Heading 1'
            )}
            shortcut="#"
          />
          <SlashRow
            iconKey="h2"
            label={translate(
              'auto.components.feature.wall.EditorAnimatedVisual.a26a68d30c',
              'Heading 2'
            )}
            shortcut="##"
          />
          <div data-slash-show="all" className="my-1 h-px bg-foreground/[0.08]" />
          <div
            data-slash-show="all"
            className="px-2 pb-1 pt-1.5 text-[9.5px] font-bold uppercase tracking-[0.06em] text-muted-foreground"
          >
            {translate(
              'auto.components.feature.wall.EditorAnimatedVisual.abbdeea15d',
              'Basic blocks'
            )}
          </div>
          <SlashRow
            iconKey="quote"
            label={translate(
              'auto.components.feature.wall.EditorAnimatedVisual.f25687c588',
              'Quote'
            )}
            shortcut=">"
          />
          <SlashRow
            iconKey="list"
            label={translate(
              'auto.components.feature.wall.EditorAnimatedVisual.37fa4948ce',
              'Bullet List'
            )}
            shortcut="-"
          />
          <SlashRow
            refCb={(el) => {
              rowCodeRef.current = el
            }}
            iconKey="code"
            label={translate(
              'auto.components.feature.wall.EditorAnimatedVisual.8268b2376b',
              'Code Block'
            )}
            shortcut="```"
          />
        </div>

        {/* Fake cursor — the loop translates it onto the highlighted slash row
            and triggers the click ripple. */}
        <div
          ref={cursorRef}
          aria-hidden
          className="pointer-events-none absolute left-0 top-0 z-20 transition-[opacity,transform] duration-[600ms] ease-[cubic-bezier(.45,.05,.2,1)]"
          style={{ opacity: 0 }}
        >
          <div className="relative">
            <CursorIcon />
            <span
              data-cursor-ripple
              className="pointer-events-none absolute -left-1.5 -top-1.5 size-7 rounded-full border-2 border-foreground/50"
              style={{ opacity: 0 }}
            />
          </div>
        </div>
      </div>

      {/* Standalone keyboard hint below the visual — same chip pattern as
          WorkbenchAnimatedVisual so the workbench sub-steps share a footer
          shape. */}
      <div className="border-t border-border bg-card px-3 py-2 text-[11px] text-muted-foreground">
        {translate('auto.components.feature.wall.EditorAnimatedVisual.3fe42a1da0', 'Type')}
        <kbd className={KBD_CLASS_DOC}>/</kbd>{' '}
        {translate('auto.components.feature.wall.EditorAnimatedVisual.8341391520', 'for blocks ·')}{' '}
        <kbd className={KBD_CLASS_DOC}>{boldShortcutLabel}</kbd>{' '}
        {translate('auto.components.feature.wall.EditorAnimatedVisual.8521536429', 'bold ·')}{' '}
        <kbd className={KBD_CLASS_DOC}>{italicShortcutLabel}</kbd>{' '}
        {translate('auto.components.feature.wall.EditorAnimatedVisual.7a763daf2f', 'italic')}
      </div>

      {/* Why: the imperative loop adds .slash-active and toggles
          [data-cursor-ripple] state via [data-clicking]. We pin those
          presentation rules here instead of TS so the React tree stays
          declarative. */}
      <style>
        {translate(
          'auto.components.feature.wall.EditorAnimatedVisual.e16479c1c5',
          '[data-slash-menu] [data-slash-row].slash-active { background: rgba(24,24,27,0.07); box-shadow: inset 0 0 0 1px rgba(24,24,27,0.06); } [data-md-active-line][data-role="active"] { color: rgb(113 113 122); font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12.5px; } [data-md-active-line][data-role="h1"] { color: inherit; font-family: inherit; font-size: 18px; font-weight: 700; letter-spacing: -0.01em; line-height: 1.2; margin-top: 6px; } [data-md-caret] { display: inline-block; width: 1.5px; height: 1em; background: currentColor; vertical-align: -2px; margin-left: 1px; animation: md-caret-blink 1.05s steps(1) infinite; } @keyframes md-caret-blink { 0%, 50% { opacity: 1 } 51%, 100% { opacity: 0 } } @keyframes md-block-in { from { opacity: 0; transform: translateY(-2px); } to { opacity: 1; transform: none; } } @keyframes md-cursor-ripple { 0% { transform: scale(0.4); opacity: 0.9; } 100% { transform: scale(1.4); opacity: 0; } } [data-clicking="1"] [data-cursor-ripple] { animation: md-cursor-ripple 460ms ease-out forwards; }'
        )}
      </style>
    </div>
  )
}


