import type { JSX, ReactNode, RefObject } from 'react'
import { cn } from '@/lib/utils'
import { ClaudeIcon } from '@/lib/agent-icon-glyphs'
import { CodexInlineIcon } from './feature-tour-preview-glyphs'
import { translate } from '@/i18n/i18n'

export type RightLine =
  | { kind: 'submitted-command'; text: string }
  | { kind: 'session-started' }
  | { kind: 'submitted-prompt'; text: string }
  | { kind: 'thinking' }
  | { kind: 'agent-action'; action: string; target: string; working?: boolean }
  | { kind: 'response-skeleton'; widthPct: number; withGlyph: boolean }

export function TerminalActivityPane(): JSX.Element {
  return (
    <>
      <TermLine>
        <Prompt>$</Prompt>
        <span className="text-foreground">git status</span>
      </TermLine>
      <TermLine muted>On branch feature/workbench</TermLine>
      <TermLine>
        <span className="mr-1.5 font-bold text-emerald-600">✓</span>
        <span className="text-foreground">working tree clean</span>
      </TermLine>
    </>
  )
}

export function ClaudeChecklistPane(props: { reducedMotion: boolean }): JSX.Element {
  return (
    <>
      <TermLine>
        <Prompt>$</Prompt>
        <span className="text-foreground">
          {translate('auto.components.feature.wall.WorkbenchAnimatedVisual.000106adfe', 'claude')}
        </span>
      </TermLine>
      <TermLine muted>
        <span className="mr-1.5 inline-flex align-[-2px]">
          <ClaudeIcon size={12} />
        </span>
        {translate(
          'auto.components.feature.wall.WorkbenchAnimatedVisual.431ca9842a',
          'Claude Code session started'
        )}
      </TermLine>
      <TermLine wrap>
        <span className="mr-1.5 text-amber-600">
          {translate('auto.components.feature.wall.WorkbenchAnimatedVisual.932c4b3a97', '>')}
        </span>
        {translate(
          'auto.components.feature.wall.WorkbenchAnimatedVisual.c0eb94125e',
          'review auth edge cases'
        )}
      </TermLine>
      <TermLine>
        <span className="mr-1.5 font-bold text-emerald-600">✓</span>
        <span className="text-foreground">
          {translate('auto.components.feature.wall.WorkbenchAnimatedVisual.9923847785', 'Read')}
        </span>
        <span className="ml-1.5 truncate text-muted-foreground">
          {translate(
            'auto.components.feature.wall.WorkbenchAnimatedVisual.b85eab49dd',
            'src/auth/session.ts'
          )}
        </span>
      </TermLine>
      <TermLine>
        <span className="mr-1.5 font-bold text-emerald-600">✓</span>
        <span className="text-foreground">
          {translate('auto.components.feature.wall.WorkbenchAnimatedVisual.17cfdc3344', 'Grep')}
        </span>
        <span className="ml-1.5 truncate text-muted-foreground">
          {translate(
            'auto.components.feature.wall.WorkbenchAnimatedVisual.0d93c298a7',
            'throw src/auth'
          )}
        </span>
      </TermLine>
      <TermLine>
        <RunSpinner reducedMotion={props.reducedMotion} />
        <span className="text-foreground">
          {translate('auto.components.feature.wall.WorkbenchAnimatedVisual.99f5224f1e', 'Edit')}
        </span>
        <span className="ml-1.5 truncate text-muted-foreground">
          {translate(
            'auto.components.feature.wall.WorkbenchAnimatedVisual.b85eab49dd',
            'src/auth/session.ts'
          )}
        </span>
      </TermLine>
    </>
  )
}

export function TermLine(props: {
  children: ReactNode
  muted?: boolean
  wrap?: boolean
}): JSX.Element {
  return (
    <div
      className={cn(
        'leading-[1.45]',
        props.muted ? 'text-muted-foreground' : null,
        props.wrap ? 'whitespace-pre-wrap break-words' : 'truncate whitespace-pre'
      )}
    >
      {props.children}
    </div>
  )
}
export function Prompt(props: { children: ReactNode; claude?: boolean }): JSX.Element {
  return (
    <span className={cn('mr-1.5', props.claude ? 'text-amber-600' : 'text-emerald-600')}>
      {props.children}
    </span>
  )
}
function RunSpinner(props: { reducedMotion?: boolean }): JSX.Element {
  return (
    <span
      className={cn(
        'mr-1.5 inline-block size-2 rounded-full border-[1.5px] border-foreground/20 align-[-1px]',
        props.reducedMotion ? 'border-t-foreground/20' : 'animate-spin border-t-foreground'
      )}
    />
  )
}

export function ContextMenu(props: {
  shown: boolean
  splitRowActive: boolean
  splitRowRef: RefObject<HTMLDivElement | null>
  splitRightShortcutLabel: string
  splitDownShortcutLabel: string
}): JSX.Element {
  return (
    <div
      className={cn(
        'absolute left-[110px] top-[78px] z-10 min-w-[218px] origin-top-left rounded-lg border border-border bg-card p-1.5 font-sans text-[12px] text-foreground shadow-[0_16px_38px_rgba(24,24,27,0.18),0_2px_6px_rgba(24,24,27,0.08)] transition-[opacity,transform] duration-[160ms] ease-out',
        props.shown ? 'opacity-100' : '-translate-y-[3px] scale-[0.985] opacity-0'
      )}
      style={{ pointerEvents: 'none' }}
    >
      <CtxSkeleton width={70} />
      <CtxSkeleton width={56} />
      <CtxSeparator />
      <div
        ref={props.splitRowRef}
        className={cn(
          'grid h-[22px] grid-cols-[18px_1fr_auto] items-center gap-2 rounded-[5px] px-1.5 py-1 pl-1.5',
          props.splitRowActive
            ? 'bg-foreground/[0.07] shadow-[inset_0_0_0_1px_rgba(24,24,27,0.06)]'
            : null
        )}
      >
        <span className="inline-flex items-center justify-center text-muted-foreground">
          <SplitIcon direction="right" />
        </span>
        <span className="whitespace-nowrap leading-none">
          {translate(
            'auto.components.feature.wall.WorkbenchAnimatedVisual.e370fa8c2b',
            'Split Terminal Right'
          )}
        </span>
        <span className="font-mono text-[11px] text-muted-foreground">
          {props.splitRightShortcutLabel}
        </span>
      </div>
      <div className="grid h-[22px] grid-cols-[18px_1fr_auto] items-center gap-2 rounded-[5px] px-1.5 py-1 pl-1.5">
        <span className="inline-flex items-center justify-center text-muted-foreground">
          <SplitIcon direction="down" />
        </span>
        <span className="whitespace-nowrap leading-none">
          {translate(
            'auto.components.feature.wall.WorkbenchAnimatedVisual.ca2cfbf188',
            'Split Terminal Down'
          )}
        </span>
        <span className="font-mono text-[11px] text-muted-foreground">
          {props.splitDownShortcutLabel}
        </span>
      </div>
      <CtxSeparator />
      <CtxSkeleton width={64} />
      <CtxSkeleton width={48} />
    </div>
  )
}
function SplitIcon(props: { direction: 'right' | 'down' }): JSX.Element {
  return (
    <svg
      viewBox="0 0 16 16"
      width={12}
      height={12}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.4}
      aria-hidden
    >
      <rect x={2.5} y={3} width={11} height={10} rx={1.4} />
      <path d={props.direction === 'right' ? 'M8 3v10' : 'M2.5 8h11'} />
    </svg>
  )
}
function CtxSkeleton(props: { width: number }): JSX.Element {
  return (
    <div className="flex h-[18px] items-center px-2.5">
      <span
        className="block h-1.5 rounded-[3px] bg-foreground/[0.16]"
        style={{ width: `${props.width}%` }}
      />
    </div>
  )
}
function CtxSeparator(): JSX.Element {
  return <div className="my-1 h-px bg-foreground/[0.08]" />
}

export function RightPaneScrollback(props: {
  lines: readonly RightLine[]
  isCodex?: boolean
  promptAccentClass?: string
}): JSX.Element {
  return (
    <>
      {props.lines.map((line, i) => {
        if (line.kind === 'submitted-command')
          return (
            <TermLine key={i}>
              <Prompt>$</Prompt>
              <span className="text-foreground">{line.text}</span>
            </TermLine>
          )
        if (line.kind === 'session-started')
          return (
            <TermLine key={i} muted>
              {props.isCodex ? (
                <span className="mr-1.5 inline-flex align-[-2px]">
                  <CodexInlineIcon />
                </span>
              ) : (
                <span className="mr-1.5 text-foreground">●</span>
              )}
              {props.isCodex
                ? translate(
                    'auto.components.feature.wall.WorkbenchAnimatedVisual.fc84f17fe7',
                    'Codex session started'
                  )
                : translate(
                    'auto.components.feature.wall.WorkbenchAnimatedVisual.431ca9842a',
                    'Claude Code session started'
                  )}
            </TermLine>
          )
        if (line.kind === 'submitted-prompt')
          return (
            <TermLine key={i} wrap>
              <span className={cn('mr-1.5', props.promptAccentClass ?? 'text-amber-600')}>
                {translate('auto.components.feature.wall.WorkbenchAnimatedVisual.932c4b3a97', '>')}
              </span>
              {line.text}
            </TermLine>
          )
        if (line.kind === 'thinking')
          return (
            <TermLine key={i}>
              <RunSpinner />
              <span className="text-muted-foreground">
                {translate(
                  'auto.components.feature.wall.WorkbenchAnimatedVisual.633a91e358',
                  'Thinking…'
                )}
              </span>
            </TermLine>
          )
        if (line.kind === 'agent-action')
          return (
            <TermLine key={i}>
              {line.working ? (
                <RunSpinner />
              ) : (
                <span className="mr-1.5 font-bold text-emerald-600">✓</span>
              )}
              <span className="text-foreground">{line.action}</span>
              <span className="ml-1.5 truncate text-muted-foreground">{line.target}</span>
            </TermLine>
          )
        return (
          <TermLine key={i}>
            {line.withGlyph ? (
              props.isCodex ? (
                <span className="mr-1.5 inline-flex align-[-2px]">
                  <CodexInlineIcon />
                </span>
              ) : (
                <span className="mr-1.5 text-amber-600">●</span>
              )
            ) : null}
            <span
              className="inline-block h-[7px] rounded-[3px] bg-foreground/[0.18] align-[1px]"
              style={{ width: `${line.widthPct}%` }}
            />
          </TermLine>
        )
      })}
    </>
  )
}
