import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import { extractIpcErrorMessage } from '@/lib/ipc-error'
import { downloadRuntimeFile, type RuntimeFileOperationArgs } from '@/runtime/runtime-file-client'
import type { GitFileStatus } from '../../../../shared/types'
import type { TreeNode } from './file-explorer-types'

export function shouldShowCollapseFolderAction(node: TreeNode, isExpanded: boolean): boolean {
  return node.isDirectory && isExpanded
}
export function shouldShowFindInFolderAction(node: TreeNode): boolean {
  return node.isDirectory
}
export function shouldShowOpenInTerminalAction(node: TreeNode): boolean {
  return node.isDirectory
}
export function shouldShowViewFileAction(node: TreeNode): boolean {
  return !node.isDirectory
}
export function shouldShowRemoteDownloadAction(
  node: TreeNode,
  connectionId?: string | null,
  runtimeDownloadContext?: RuntimeFileOperationArgs | null,
  supportsFolderDownload = false
): boolean {
  const hasDownloadCapability = node.isDirectory
    ? Boolean(connectionId && supportsFolderDownload)
    : Boolean(connectionId || runtimeDownloadContext)
  return hasDownloadCapability && (globalThis as { __ORCA_WEB_CLIENT__?: boolean }).__ORCA_WEB_CLIENT__ !== true
}
export function shouldShowCopyFileAction(
  node: TreeNode,
  connectionId?: string | null,
  selectionSize = 1
): boolean {
  return (
    (!connectionId || !node.isDirectory) &&
    selectionSize === 1 &&
    (globalThis as { __ORCA_WEB_CLIENT__?: boolean }).__ORCA_WEB_CLIENT__ !== true
  )
}
export async function downloadRemoteFile(
  node: TreeNode,
  connectionIdOrRuntimeContext: string | RuntimeFileOperationArgs
): Promise<void> {
  try {
    const result = typeof connectionIdOrRuntimeContext === 'string'
      ? node.isDirectory
        ? await window.api.fs.downloadFolder({ dirPath: node.path, connectionId: connectionIdOrRuntimeContext })
        : await window.api.fs.downloadFile({ filePath: node.path, connectionId: connectionIdOrRuntimeContext })
      : await downloadRuntimeFile(connectionIdOrRuntimeContext, node.path, node.name)
    if (result.canceled) return
    toast.success(
      node.isDirectory
        ? translate('auto.components.right.sidebar.FileExplorerRow.a4029c996b', "Downloaded folder '{{value0}}'", { value0: node.name })
        : translate('auto.components.right.sidebar.FileExplorerRow.bce4d4e44f', "Downloaded '{{value0}}'", { value0: node.name }),
      { action: { label: translate('auto.components.right.sidebar.FileExplorerRow.1a3df04ae1', 'Open'), onClick: () => void window.api.shell.openPath(result.destinationPath) } }
    )
  } catch (error) {
    toast.error(extractIpcErrorMessage(error, node.isDirectory
      ? translate('auto.components.right.sidebar.FileExplorerRow.f729bcd97d', "Failed to download folder '{{value0}}'.", { value0: node.name })
      : translate('auto.components.right.sidebar.FileExplorerRow.b3e288bf41', "Failed to download '{{value0}}'.", { value0: node.name })))
  }
}
export async function copyFileToOsClipboard(node: TreeNode, connectionId?: string | null): Promise<void> {
  const failureMessage = translate('auto.components.right.sidebar.FileExplorerRow.b234ab25b4', 'Could not copy the file to the clipboard')
  try {
    const result = await window.api.ui.writeClipboardFile(connectionId ? { filePath: node.path, connectionId } : node.path)
    if (!result.ok) toast.error(failureMessage)
  } catch (error) {
    toast.error(extractIpcErrorMessage(error, failureMessage))
  }
}

export type FileExplorerRowStatus = GitFileStatus
