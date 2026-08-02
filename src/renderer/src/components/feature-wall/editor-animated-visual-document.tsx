// Concrete surface implementation for EditorAnimatedVisual.tsx
import { useEffect, useRef } from 'react'
import type { JSX, ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { getShortcutPlatform } from '@/hooks/useShortcutLabel'
import { translate } from '@/i18n/i18n'

// Why: the visual leans on direct DOM mutation (typing into a node, swapping
// classes, anchoring a floating menu by measured rect) so the loop reads
// like the HTML mock instead of fighting React's reconciliation.

export function DocTitle(props: { children: ReactNode }): JSX.Element {
  return (
    <div className="mb-2.5 text-[22px] font-bold leading-[1.15] tracking-[-0.01em]">
      {props.children}
    </div>
  )
}

export function DocBlock(props: { children: ReactNode; listItem?: boolean }): JSX.Element {
  if (props.listItem) {
    return (
      <div className="relative mt-1.5 min-h-[18px] py-px pl-[18px] text-[13px] leading-[1.55]">
        <span className="absolute left-1.5 top-[9px] size-1 rounded-full bg-foreground/55" />
        {props.children}
      </div>
    )
  }
  return (
    <div className="mt-1.5 min-h-[18px] py-px text-[13px] leading-[1.55]">{props.children}</div>
  )
}

export function ActiveLine(props: {
  activeLineRef: React.RefObject<HTMLDivElement | null>
  activeTextRef: React.RefObject<HTMLSpanElement | null>
}): JSX.Element {
  return (
    <div
      ref={props.activeLineRef}
      data-md-active-line
      data-role="active"
      className={activeLineClass()}
    >
      <span ref={props.activeTextRef} data-md-active-text="1" />
      <span data-md-caret="1" className={caretClass()} />
    </div>
  )
}

// Helpers shared between initial render and re-created beat-2 lines so the
// styling stays in lockstep regardless of which path mounts the node.
export function activeLineClass(): string {
  return 'relative mt-1.5 min-h-[18px] py-px'
}
export function caretClass(): string {
  return 'inline-block'
}

export function codeBlockHTML(): string {
  return `
    <div style="background: rgba(24,24,27,0.04); border: 1px solid rgba(24,24,27,0.10); border-radius: 8px; overflow: hidden; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11.5px; line-height: 1.55;">
      <div style="display: flex; align-items: center; justify-content: space-between; padding: 5px 9px; border-bottom: 1px solid rgba(24,24,27,0.10); background: rgba(24,24,27,0.04);">
        <span style="font-size: 10px; font-weight: 600; color: rgb(113 113 122); letter-spacing: 0.02em;">typescript</span>
        <span style="display: inline-flex; align-items: center; gap: 4px; font-size: 9.5px; color: rgb(113 113 122);">
          <svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="5" width="8" height="8" rx="1.4"/><path d="M3 11V4a1 1 0 0 1 1-1h7"/></svg>
          <span>Copy</span>
        </span>
      </div>
      <div style="padding: 8px 11px; background: #fff; display: flex; flex-direction: column; gap: 2px;">
        <div><span style="color:#a855f7;">await</span> <span style="color:#2563eb;">runSmokeTests</span><span style="color:rgb(113 113 122);">({</span> env<span style="color:rgb(113 113 122);">:</span> <span style="color:#16a34a;">'staging'</span> <span style="color:rgb(113 113 122);">})</span></div>
        <div><span style="color:#a855f7;">await</span> <span style="color:#2563eb;">publish</span><span style="color:rgb(113 113 122);">({</span> tag<span style="color:rgb(113 113 122);">:</span> <span style="color:#16a34a;">'v0.4.0'</span> <span style="color:rgb(113 113 122);">})</span></div>
      </div>
    </div>`
}

