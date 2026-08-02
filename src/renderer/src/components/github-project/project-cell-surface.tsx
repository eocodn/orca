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

import ProjectCell, { Props, TitleCell } from './project-cell-surface-props-section'
import { TypeCell, IssueTypeCell } from './project-cell-surface-type-cell-section'
import { SingleSelectCell, IterationCell, IterationRow } from './project-cell-surface-single-select-cell-section'
import { TextCell, DateCell, LabelChip, UserChip } from './project-cell-surface-text-cell-section'
import { AssigneesCell, LabelsCell, EmptyCellPrompt, colorHex } from './project-cell-surface-assignees-cell-section'
import { SINGLE_SELECT_HEX, ChipColors, chipStyle, singleSelectChipColors, labelChipColors, rgbToHsl, hslToCss } from './project-cell-surface-single-select-hex-section'

export { TitleCell, TypeCell, IssueTypeCell, SingleSelectCell, IterationCell, IterationRow, TextCell, DateCell, LabelChip, UserChip, AssigneesCell, LabelsCell, EmptyCellPrompt, colorHex, SINGLE_SELECT_HEX, chipStyle, singleSelectChipColors, labelChipColors, rgbToHsl, hslToCss }
export type { Props, ChipColors }
export { default } from './project-cell-surface-props-section'
