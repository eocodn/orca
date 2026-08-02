import type { BrowserPoint } from './browser-touch-geometry'

export type MobileBrowserTab = {
  type: 'browser'
  id: string
  title: string
  browserWorkspaceId: string
  browserPageId: string | null
  url: string
  loading: boolean
  canGoBack: boolean
  canGoForward: boolean
  isActive: boolean
}

export type PanGesture = {
  x: number
  y: number
  offsetX: number
  offsetY: number
}

export type BrowserDialogState = {
  dialogType: string
  message: string
}

export type BrowserPageParams = {
  worktree: string
  page: string
}

export type PendingWheelCommand = {
  base: BrowserPageParams
  point: BrowserPoint
  gestureId: number
  dx: number
  dy: number
}
