import type React from 'react'
import { useEffect, useRef, useState } from 'react'
import { ScrollArea } from '../ui/scroll-area'
import { Input } from '../ui/input'
import { Label } from '../ui/label'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'
import { normalizeColor, type TerminalThemeOption } from '@/lib/terminal-theme'
import { MAX_THEME_RESULTS } from './SettingsConstants'
import {
  filterTerminalThemeOptions,
  isSettingsFormOptionQueryTooLarge
} from './settings-form-option-filter'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'

export { FontAutocomplete } from './settings-font-autocomplete'

type SettingsSwitchProps = {
  checked: boolean
  onChange: () => void
  ariaLabel?: string
  ariaLabelledBy?: string
  disabled?: boolean
}

export function SettingsSwitch({
  checked,
  onChange,
  ariaLabel,
  ariaLabelledBy,
  disabled
}: SettingsSwitchProps): React.JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy}
      disabled={disabled}
      onClick={onChange}
      className={cn(
        'relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border border-transparent outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50',
        checked ? 'bg-foreground' : 'bg-muted-foreground/30'
      )}
    >
      <span
        className={cn(
          'pointer-events-none block size-3.5 rounded-full bg-background shadow-sm transition-transform',
          checked ? 'translate-x-4' : 'translate-x-0.5'
        )}
      />
    </button>
  )
}

type SettingsRowProps = {
  label: React.ReactNode
  description?: React.ReactNode
  control: React.ReactNode
  className?: string
  /** Optional id applied to the label so the control can reference it via aria-labelledby. */
  labelId?: string
  /** When true, top-align label/description and control. Useful for tall control columns. */
  alignTop?: boolean
}

/** Two-column row grammar: left min-w-0 label+description, right shrink-0 control. */
export function SettingsRow({
  label,
  description,
  control,
  className,
  labelId,
  alignTop
}: SettingsRowProps): React.JSX.Element {
  return (
    <div
      className={cn(
        'flex gap-4',
        description ? 'py-3' : 'py-2',
        alignTop ? 'items-start' : 'items-center justify-between',
        className
      )}
    >
      <div className={cn('min-w-0 flex-1', description ? 'space-y-1' : 'space-y-0.5')}>
        <Label id={labelId} className="select-text">
          {label}
        </Label>
        {description ? (
          <p className="select-text text-xs text-muted-foreground">{description}</p>
        ) : null}
      </div>
      <div className="shrink-0">{control}</div>
    </div>
  )
}

type SettingsSwitchRowProps = {
  label: React.ReactNode
  description?: React.ReactNode
  checked: boolean
  onChange: () => void
  className?: string
  ariaLabel?: string
}

export function SettingsSwitchRow({
  label,
  description,
  checked,
  onChange,
  className,
  ariaLabel
}: SettingsSwitchRowProps): React.JSX.Element {
  return (
    <SettingsRow
      label={label}
      description={description}
      className={className}
      control={
        <SettingsSwitch
          checked={checked}
          onChange={onChange}
          ariaLabel={ariaLabel ?? (typeof label === 'string' ? label : undefined)}
        />
      }
    />
  )
}

type SegmentedOption<T extends string | number> = {
  value: T
  label: React.ReactNode
  disabled?: boolean
  ariaLabel?: string
  /** Optional hover label describing what the option does. */
  tooltip?: React.ReactNode
}

type SettingsSegmentedControlProps<T extends string | number> = {
  value: T
  onChange: (value: T) => void
  options: readonly SegmentedOption<T>[]
  ariaLabel?: string
  size?: 'sm' | 'md'
  equalWidth?: boolean
}

/** Canonical segmented control for theme/ligatures/cursor/shell/etc. */
export function SettingsSegmentedControl<T extends string | number>({
  value,
  onChange,
  options,
  ariaLabel,
  size = 'md',
  equalWidth = false
}: SettingsSegmentedControlProps<T>): React.JSX.Element {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn(
        'inline-flex items-center rounded-md border border-border bg-background/50 p-0.5',
        equalWidth && 'w-full'
      )}
    >
      {options.map((opt) => {
        const active = opt.value === value
        const button = (
          <button
            key={String(opt.value)}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={opt.ariaLabel}
            disabled={opt.disabled}
            onClick={() => {
              if (!opt.disabled) {
                onChange(opt.value)
              }
            }}
            className={cn(
              'rounded-sm text-center outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50',
              size === 'sm' ? 'px-2.5 py-0.5 text-xs' : 'px-3 py-1 text-sm',
              equalWidth && 'flex-1',
              active
                ? 'bg-accent font-medium text-accent-foreground'
                : opt.disabled
                  ? 'cursor-not-allowed text-muted-foreground/50'
                  : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {opt.label}
          </button>
        )
        if (opt.tooltip == null) {
          return button
        }
        return (
          <Tooltip key={String(opt.value)}>
            <TooltipTrigger asChild>{button}</TooltipTrigger>
            <TooltipContent>{opt.tooltip}</TooltipContent>
          </Tooltip>
        )
      })}
    </div>
  )
}

type SettingsBadgeProps = {
  tone?: 'neutral' | 'accent' | 'muted'
  children: React.ReactNode
  className?: string
}

/** Tokenized badge for status pills inside settings (e.g. Detected, Not installed). */
export function SettingsBadge({
  tone = 'neutral',
  children,
  className
}: SettingsBadgeProps): React.JSX.Element {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium',
        tone === 'accent'
          ? 'border-foreground/20 bg-foreground/10 text-foreground'
          : tone === 'muted'
            ? 'border-border/40 bg-muted/30 text-muted-foreground'
            : 'border-border/50 bg-background/50 text-foreground/80',
        className
      )}
    >
      {children}
    </span>
  )
}

type SettingsSubsectionHeaderProps = {
  title: React.ReactNode
  description?: React.ReactNode
  action?: React.ReactNode
  className?: string
}

/** Consistent subsection header: h3 text-sm font-semibold + optional muted description. */
export function SettingsSubsectionHeader({
  title,
  description,
  action,
  className
}: SettingsSubsectionHeaderProps): React.JSX.Element {
  return (
    <div className={cn('flex items-start justify-between gap-3', className)}>
      <div className="space-y-1">
        <h3 className="text-sm font-semibold">{title}</h3>
        {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  )
}

type ThemePickerProps = {
  label: string
  description: string
  selectedTheme: string
  themeOptions: TerminalThemeOption[]
  query: string
  onQueryChange: (value: string) => void
  onSelectTheme: (theme: string) => void
  /** Bumps when themes are imported; scrolls the Imported group into view and
   *  briefly highlights it so freshly-imported themes are easy to find. */
  importedHighlightSignal?: number
}

type ColorFieldProps = {
  label: string
  description: string
  value: string
  fallback: string
  onChange: (value: string) => void
}

type NumberFieldProps = {
  label: string
  description: string
  value: number
  defaultValue?: number
  min: number
  max: number
  step?: number
  onChange: (value: number) => void
  suffix?: string
}

export function ThemePicker({
  label,
  description,
  selectedTheme,
  themeOptions,
  query,
  onQueryChange,
  onSelectTheme,
  importedHighlightSignal
}: ThemePickerProps): React.JSX.Element {
  const importedGroupRef = useRef<HTMLDivElement | null>(null)
  const [highlightImported, setHighlightImported] = useState(false)

  // Why: imported themes render below the built-in list inside a fixed-height
  // scroll area, so after an import they sit off-screen. On each import signal,
  // scroll the Imported group into view and flash a highlight so it's easy to spot.
  useEffect(() => {
    if (!importedHighlightSignal) {
      return
    }
    importedGroupRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    setHighlightImported(true)
    const timer = setTimeout(() => setHighlightImported(false), 2000)
    return () => clearTimeout(timer)
  }, [importedHighlightSignal])

  const themeQuery = query.trim()
  const shouldShowThemeQueryLabel =
    themeQuery.length > 0 && !isSettingsFormOptionQueryTooLarge(themeQuery)
  const matchingThemes = filterTerminalThemeOptions(themeOptions, query)
  const selectedThemeLabel =
    themeOptions.find((option) => option.value === selectedTheme)?.label ?? selectedTheme
  const groupedThemes = [
    {
      label: translate('auto.components.settings.SettingsFormControls.builtin_themes', 'Built-in'),
      themes: matchingThemes
        .filter((theme) => theme.group === 'built-in')
        .slice(0, MAX_THEME_RESULTS)
    },
    {
      label: translate('auto.components.settings.SettingsFormControls.imported_themes', 'Imported'),
      themes: matchingThemes
        .filter((theme) => theme.group === 'imported')
        .slice(0, MAX_THEME_RESULTS)
    }
  ].filter((group) => group.themes.length > 0)
  const visibleThemeCount = groupedThemes.reduce((sum, group) => sum + group.themes.length, 0)

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <Label>{label}</Label>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <Input
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        placeholder={translate(
          'auto.components.settings.SettingsFormControls.search_terminal_themes',
          'Search terminal themes'
        )}
      />
      <div className="rounded-lg border border-border/50">
        <div className="flex items-center justify-between border-b border-border/50 px-3 py-2 text-xs text-muted-foreground">
          <span>
            {translate('auto.components.settings.SettingsFormControls.fbb428db98', 'Selected:')}{' '}
            {selectedThemeLabel}
          </span>
          <span>
            {translate('auto.components.settings.SettingsFormControls.4e11f87ca6', 'Showing')}{' '}
            {visibleThemeCount}
            {shouldShowThemeQueryLabel
              ? translate(
                  'auto.components.settings.SettingsFormControls.c822571b2e',
                  ' matching "{{value0}}"',
                  { value0: themeQuery }
                )
              : translate(
                  'auto.components.settings.SettingsFormControls.cb330ef7f8',
                  ' of {{value0}}',
                  { value0: themeOptions.length }
                )}
          </span>
        </div>
        <ScrollArea className="h-64">
          <div className="space-y-1 p-2">
            {groupedThemes.map((group) => {
              const isImported =
                group.label ===
                translate(
                  'auto.components.settings.SettingsFormControls.imported_themes',
                  'Imported'
                )
              return (
                <div
                  key={group.label}
                  ref={isImported ? importedGroupRef : undefined}
                  className={cn(
                    'space-y-1 rounded-md transition-colors duration-500',
                    isImported && highlightImported && 'bg-accent/40 ring-1 ring-accent'
                  )}
                >
                  <p className="px-3 pt-2 text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">
                    {group.label}
                  </p>
                  {group.themes.map((theme) => (
                    <button
                      key={theme.value}
                      onClick={() => onSelectTheme(theme.value)}
                      className={cn(
                        'flex w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors',
                        selectedTheme === theme.value
                          ? 'bg-accent font-medium text-accent-foreground'
                          : 'hover:bg-accent'
                      )}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">{theme.label}</span>
                        {theme.sourceLabel ? (
                          <span className="block truncate text-[11px] font-normal text-muted-foreground">
                            {translate(
                              'auto.components.settings.SettingsFormControls.imported_from',
                              'Imported from {{value0}}',
                              { value0: theme.sourceLabel }
                            )}
                            {theme.mode && theme.mode !== 'unknown' ? ` · ${theme.mode}` : ''}
                          </span>
                        ) : null}
                      </span>
                      {/* Why: hide swatches on the current row so the color grid
                        doesn't shift left to make room for the "Current" label. */}
                      {theme.group === 'imported' &&
                      theme.previewTheme &&
                      selectedTheme !== theme.value ? (
                        <span className="flex shrink-0 overflow-hidden rounded-sm border border-border/60">
                          {[
                            theme.previewTheme.black,
                            theme.previewTheme.red,
                            theme.previewTheme.green,
                            theme.previewTheme.yellow,
                            theme.previewTheme.blue,
                            theme.previewTheme.magenta,
                            theme.previewTheme.cyan,
                            theme.previewTheme.white
                          ].map((color, index) => (
                            <span
                              key={index}
                              className="h-3 w-2"
                              style={{ backgroundColor: color ?? 'transparent' }}
                            />
                          ))}
                        </span>
                      ) : null}
                      {selectedTheme === theme.value ? (
                        <span className="ml-3 shrink-0 text-[11px] uppercase tracking-[0.16em]">
                          {translate(
                            'auto.components.settings.SettingsFormControls.9119fb2268',
                            'Current'
                          )}
                        </span>
                      ) : null}
                    </button>
                  ))}
                </div>
              )
            })}
            {visibleThemeCount === 0 ? (
              <div className="px-3 py-6 text-sm text-muted-foreground">
                {translate(
                  'auto.components.settings.SettingsFormControls.ceefb9d7f1',
                  'No themes found.'
                )}
              </div>
            ) : null}
          </div>
        </ScrollArea>
      </div>
    </div>
  )
}

export function ColorField({
  label,
  description,
  value,
  fallback,
  onChange
}: ColorFieldProps): React.JSX.Element {
  const normalized = normalizeColor(value, fallback)

  return (
    <SettingsRow
      label={label}
      description={description}
      control={
        <div className="flex items-center gap-2">
          <input
            type="color"
            value={normalized}
            onChange={(e) => onChange(e.target.value)}
            className="h-8 w-10 rounded-md border border-input bg-transparent p-1"
          />
          <Input
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={fallback}
            className="w-32 text-xs"
          />
        </div>
      }
    />
  )
}

export function NumberField({
  label,
  description,
  value,
  defaultValue,
  min,
  max,
  step = 1,
  onChange,
  suffix
}: NumberFieldProps): React.JSX.Element {
  const [draft, setDraft] = useState(Number.isFinite(value) ? String(value) : '')
  const [prevValue, setPrevValue] = useState(value)

  // Sync draft when the external value changes (e.g. from another source)
  if (value !== prevValue) {
    setPrevValue(value)
    setDraft(Number.isFinite(value) ? String(value) : '')
  }

  const commit = (): void => {
    const trimmed = draft.trim()
    if (trimmed === '') {
      // Empty input — reset to current value rather than committing 0
      setDraft(Number.isFinite(value) ? String(value) : '')
      return
    }
    const next = Number(trimmed)
    if (Number.isFinite(next)) {
      const clamped = Math.min(max, Math.max(min, next))
      onChange(clamped)
      setDraft(String(clamped))
    } else {
      // Reset to current value if input is invalid
      setDraft(Number.isFinite(value) ? String(value) : '')
    }
  }

  return (
    <SettingsRow
      label={label}
      description={
        <>
          {description}
          {defaultValue !== undefined ? (
            <span className="ml-1 text-muted-foreground/70">
              {translate('auto.components.settings.SettingsFormControls.b661b034ec', '· Default:')}{' '}
              {defaultValue}
            </span>
          ) : null}
        </>
      }
      control={
        <div className="flex items-center gap-2">
          <Input
            type="number"
            min={min}
            max={max}
            step={step}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                commit()
              }
            }}
            className="number-input-clean w-24 tabular-nums"
          />
          {suffix ? <span className="shrink-0 text-xs text-muted-foreground">{suffix}</span> : null}
        </div>
      }
    />
  )
}
