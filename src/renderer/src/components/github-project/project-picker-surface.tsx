// Concrete surface implementation for ProjectPicker.tsx
// Why: the picker is the only v1 entry point for switching projects (no
// header tab strip). Pinned + Recent come from settings; Browse all lazy-loads
// from `listAccessibleProjects` and is cached for 5 minutes. Paste-to-add
// accepts org/user project URLs and `owner/number` shorthand.
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, Loader, Search } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useAppStore } from '@/store'
import { useMountedRef } from '@/hooks/useMountedRef'
import type {
  GitHubProjectOwnerType,
  GitHubProjectSettings,
  GitHubProjectSummary,
  GitHubProjectViewError,
  GitHubProjectViewSummary
} from '../../../../shared/github-project-types'
import {
  hasBoundedGitHubProjectRefInputText,
  isGitHubProjectRefInputTooLarge
} from '../../../../shared/github-project-ref-input'
import { filterGitHubProjectPickerProjects } from './github-project-picker-filter'
import {
  getProjectPickerBrowseCacheEntry,
  peekProjectPickerBrowseCacheEntry,
  rememberProjectPickerBrowseCacheEntry
} from './project-picker-browse-cache'
import { translate } from '@/i18n/i18n'
import {
  githubProjectHost,
  githubProjectIdentityKey
} from '../../../../shared/github-project-identity'
import {
  getProjectPickerBrowseHost,
  getProjectPickerRuntimeScope,
  listAccessibleProjectsForRuntime,
  listProjectViewsForRuntime,
  resolveProjectRefForRuntime
} from './project-picker-runtime'
import {
  GITHUB_PROJECT_REF_INPUT_TOO_LARGE_ERROR,
  parseProjectInput
} from './project-picker-input'
import {
  AuthErrorBanner,
  PartialFailuresBanner,
  PickerRow,
  Section,
  ViewPickStep
} from './project-picker-presentational'

export { getProjectPickerBrowseHost } from './project-picker-runtime'
export { parseProjectInput } from './project-picker-input'

import { ResolvedProjectSelection, Props } from './project-picker-surface-resolved-project-selection-section'
import ProjectPicker from './project-picker-surface-project-picker-section'

export type { ResolvedProjectSelection, Props }
export { default } from './project-picker-surface-project-picker-section'
