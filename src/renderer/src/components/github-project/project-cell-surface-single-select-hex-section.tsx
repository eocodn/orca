// Concrete surface implementation for ProjectCell.tsx
/* oxlint-disable react-doctor/no-adjust-state-on-prop-change -- Why: Project field details are fetched from provider metadata IPC after the concrete field/value identity is known. */
// Why: one cell per visible column. Dispatch on `field.dataType` first (so
// built-in ASSIGNEES/LABELS cells render their dedicated content) and fall
// through to `fieldValuesByFieldId[field.id].kind` as a safety net so a
// fetched value is never silently dropped.
import React, { useMemo, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { CircleDot, FileText, GitPullRequest, Lock, Plus } from 'lucide-react'
import { TYPE_FIELD_DATA_TYPE } from './columns'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { useRepoAssigneesBySlug, useRepoLabelsBySlug } from '@/hooks/useGitHubSlugMetadata'
import { useAppStore } from '@/store'
import { callRuntimeRpc, getActiveRuntimeTarget } from '@/runtime/runtime-rpc-client'
import { useRepoSlugIndex } from '@/lib/repo-slug-index'
import { getSettingsForRepoRuntimeOwner } from '@/lib/repo-runtime-owner'
import type {
  GitHubIssueType,
  GitHubProjectField,
  GitHubProjectFieldMutationValue,
  GitHubProjectLabel,
  GitHubProjectRow,
  GitHubProjectUser,
  ListIssueTypesBySlugResult
} from '../../../../shared/github-project-types'
import type { GlobalSettings } from '../../../../shared/types'
import { translate } from '@/i18n/i18n'
import { ProjectCell, TitleCell, TypeCell, IssueTypeCell, SingleSelectCell, IterationCell, IterationRow, TextCell, DateCell, LabelChip, UserChip, AssigneesCell, LabelsCell, EmptyCellPrompt, colorHex } from './project-cell-surface'
import type { Props } from './project-cell-surface'
export const SINGLE_SELECT_HEX: Record<string, string> = {
  GRAY: '#8b949e',
  RED: '#f85149',
  ORANGE: '#db6d28',
  YELLOW: '#d29922',
  GREEN: '#3fb950',
  BLUE: '#58a6ff',
  PURPLE: '#bc8cff',
  PINK: '#db61a2'
}
export type ChipColors = {
  bg: string
  fgLight: string
  fgDark: string
  border: string
}
export function chipStyle(colors: ChipColors): React.CSSProperties {
  return {
    '--github-project-chip-fg-light': colors.fgLight,
    '--github-project-chip-fg-dark': colors.fgDark,
    backgroundColor: colors.bg,
    boxShadow: `inset 0 0 0 1px ${colors.border}`
  } as React.CSSProperties
}
export function singleSelectChipColors(color: string): ChipColors {
  if (!color) {
    return labelChipColors('')
  }
  const upper = color.toUpperCase()
  const hex = SINGLE_SELECT_HEX[upper]
  if (hex) {
    return labelChipColors(hex)
  }
  return labelChipColors(color)
}

// Why: GitHub renders labels in dark mode as a low-alpha tint of the label
// color with text re-mapped to a lightness that reads well on the tint. We
// approximate Primer's algorithm so our chips match the GitHub UI.
export function labelChipColors(color: string): ChipColors {
  const fallback = {
    bg: 'rgba(125,125,125,0.18)',
    fgLight: '#4b5563',
    fgDark: '#e6edf3',
    border: 'rgba(125,125,125,0.36)'
  }
  if (!color) {
    return fallback
  }
  const hex = color.startsWith('#') ? color.slice(1) : color
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) {
    return fallback
  }
  const r = Number.parseInt(hex.slice(0, 2), 16)
  const g = Number.parseInt(hex.slice(2, 4), 16)
  const b = Number.parseInt(hex.slice(4, 6), 16)
  const [h, s] = rgbToHsl(r, g, b)
  const bg = `rgba(${r}, ${g}, ${b}, 0.18)`
  const border = `rgba(${r}, ${g}, ${b}, 0.3)`
  // Why: the dark-theme text lift turns chips into near-white-on-pastel in
  // light mode. Keep the same tint, but anchor text in the darker hue range.
  const fgLight = hslToCss(h, Math.max(s, 0.45), 0.32)
  // Primer dark-theme label: bg ~18% alpha of base, border ~30%, text lifted
  // to L≈85% so it stays bright but keeps the hue.
  const fgDark = hslToCss(h, Math.max(s, 0.5), 0.85)
  return { bg, fgLight, fgDark, border }
}
export function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const l = (max + min) / 2
  const d = max - min
  if (d === 0) {
    return [0, 0, l]
  }
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h = 0
  switch (max) {
    case rn:
      h = ((gn - bn) / d + (gn < bn ? 6 : 0)) * 60
      break
    case gn:
      h = ((bn - rn) / d + 2) * 60
      break
    default:
      h = ((rn - gn) / d + 4) * 60
  }
  return [h, s, l]
}
export function hslToCss(h: number, s: number, l: number): string {
  return `hsl(${h.toFixed(0)} ${(s * 100).toFixed(0)}% ${(l * 100).toFixed(0)}%)`
}
