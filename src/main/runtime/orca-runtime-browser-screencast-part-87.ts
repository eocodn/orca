import { type BrowserScreencastResult, RuntimeBrowserCommands, RuntimeEmulatorCommands, BrowserError } from './orca-runtime-symbols'
import { OrcaRuntimeNotifyLinearLinkedIssueUpdatedPart86 } from './orca-runtime-notify-linear-linked-issue-updated-part-86'

export class OrcaRuntimeBrowserScreencastPart87 extends OrcaRuntimeNotifyLinearLinkedIssueUpdatedPart86 {
  async browserScreencast(
    params: Parameters<RuntimeBrowserCommands['browserScreencast']>[0],
    options: {
      connectionId?: string
      sendBinary?: (bytes: Uint8Array<ArrayBufferLike>) => boolean | void
      signal?: AbortSignal
      emit: (result: BrowserScreencastResult) => void
    }
  ): Promise<void> {
    if (!options.sendBinary) {
      throw new BrowserError(
        'browser_error',
        'Browser screencast requires a binary streaming transport.'
      )
    }

    const connectionKey = options.connectionId ?? 'local'
    const requestedPageId = typeof params.page === 'string' ? params.page : null
    let existingPageStream = requestedPageId
      ? this.activeBrowserScreencastsByPage.get(requestedPageId)
      : undefined
    while (existingPageStream) {
      // Why: CDP allows only one screencast per page; cancel a stale stream so the next tab activation isn't stuck on an already-active error or old viewport.
      existingPageStream.cancel(existingPageStream.connectionKey !== connectionKey)
      await existingPageStream.done
      existingPageStream = requestedPageId
        ? this.activeBrowserScreencastsByPage.get(requestedPageId)
        : undefined
    }
    let existingStream = this.activeBrowserScreencastsByConnection.get(connectionKey)
    while (existingStream) {
      existingStream.cancel()
      await existingStream.done
      existingStream = this.activeBrowserScreencastsByConnection.get(connectionKey)
    }
    if (options.signal?.aborted) {
      throw new BrowserError('browser_error', 'Browser screencast was cancelled.')
    }

    let screencast: Awaited<ReturnType<RuntimeBrowserCommands['browserScreencast']>> | null = null
    let registeredSubscriptionId: string | null = null
    let activeBrowserPageId: string | null = null
    let ended = false
    let cancelledBeforeStart = false
    let readyEmitted = false
    let resolveActiveDone!: () => void
    const activeDone = new Promise<void>((resolve) => {
      resolveActiveDone = resolve
    })
    const end = (emitEnd: boolean): void => {
      if (ended) {
        return
      }
      ended = true
      screencast?.session.stop()
      if (emitEnd && screencast) {
        options.emit({ type: 'end', subscriptionId: screencast.subscriptionId })
      }
    }
    const cancel = (emitEnd = false): void => {
      if (!screencast) {
        cancelledBeforeStart = true
        return
      }
      end(emitEnd)
    }
    const abortScreencast = (): void => cancel()
    const sendBinaryAfterReady = (bytes: Uint8Array<ArrayBufferLike>): boolean | void => {
      if (!readyEmitted) {
        // Why: clients learn the owning subscription from ready, so CDP frames must stay unacked until the JSON ready event is delivered.
        return false
      }
      return options.sendBinary?.(bytes)
    }

    // Why: a phone can rotate before the first stream reaches ready (no subscriptionId yet), so a same-socket replacement cancels and waits here instead of racing.
    this.activeBrowserScreencastsByConnection.set(connectionKey, {
      cancel,
      done: activeDone,
      connectionKey
    })
    options.signal?.addEventListener('abort', abortScreencast, { once: true })
    try {
      screencast = await this.browserCommands.browserScreencast(params, {
        sendBinary: sendBinaryAfterReady,
        emit: options.emit
      })
      if (cancelledBeforeStart || options.signal?.aborted) {
        end(false)
        await screencast.session.done
        return
      }
      activeBrowserPageId = screencast.ready.browserPageId
      this.activeBrowserScreencastsByPage.set(activeBrowserPageId, {
        cancel,
        done: activeDone,
        connectionKey
      })
      this.setBrowserDriver(activeBrowserPageId, { kind: 'mobile', clientId: connectionKey })

      // Why: screencast frames are connection-scoped; tie Page.stopScreencast to the exact socket so dropped connections don't leave Chromium streaming.
      this.registerSubscriptionCleanup(
        screencast.subscriptionId,
        () => end(true),
        options.connectionId
      )
      registeredSubscriptionId = screencast.subscriptionId
      options.emit(screencast.ready)
      readyEmitted = true
      await screencast.session.done
      end(true)
      this.cleanupSubscription(screencast.subscriptionId)
    } finally {
      options.signal?.removeEventListener('abort', abortScreencast)
      if (!ended) {
        end(false)
      }
      if (registeredSubscriptionId) {
        this.cleanupSubscription(registeredSubscriptionId)
      }
      const active = this.activeBrowserScreencastsByConnection.get(connectionKey)
      if (active?.done === activeDone) {
        this.activeBrowserScreencastsByConnection.delete(connectionKey)
      }
      if (activeBrowserPageId) {
        const activePageStream = this.activeBrowserScreencastsByPage.get(activeBrowserPageId)
        if (activePageStream?.done === activeDone) {
          this.activeBrowserScreencastsByPage.delete(activeBrowserPageId)
        }
        const driver = this.getBrowserDriver(activeBrowserPageId)
        if (driver.kind === 'mobile' && driver.clientId === connectionKey) {
          this.setBrowserDriver(activeBrowserPageId, { kind: 'idle' })
        }
      }
      resolveActiveDone()
    }
  }

  browserEval: RuntimeBrowserCommands['browserEval'] = this.browserCommands.browserEval.bind(
    this.browserCommands
  )

  browserTabList: RuntimeBrowserCommands['browserTabList'] =
    this.browserCommands.browserTabList.bind(this.browserCommands)
  browserProceedCertificate: RuntimeBrowserCommands['browserProceedCertificate'] =
    this.browserCommands.browserProceedCertificate.bind(this.browserCommands)

  browserTabShow: RuntimeBrowserCommands['browserTabShow'] =
    this.browserCommands.browserTabShow.bind(this.browserCommands)

  browserTabCurrent: RuntimeBrowserCommands['browserTabCurrent'] =
    this.browserCommands.browserTabCurrent.bind(this.browserCommands)

  browserTabSwitch: RuntimeBrowserCommands['browserTabSwitch'] =
    this.browserCommands.browserTabSwitch.bind(this.browserCommands)

  browserHover: RuntimeBrowserCommands['browserHover'] = this.browserCommands.browserHover.bind(
    this.browserCommands
  )

  browserDrag: RuntimeBrowserCommands['browserDrag'] = this.browserCommands.browserDrag.bind(
    this.browserCommands
  )

  browserUpload: RuntimeBrowserCommands['browserUpload'] = this.browserCommands.browserUpload.bind(
    this.browserCommands
  )

  browserWait: RuntimeBrowserCommands['browserWait'] = this.browserCommands.browserWait.bind(
    this.browserCommands
  )

  browserCheck: RuntimeBrowserCommands['browserCheck'] = this.browserCommands.browserCheck.bind(
    this.browserCommands
  )

  browserFocus: RuntimeBrowserCommands['browserFocus'] = this.browserCommands.browserFocus.bind(
    this.browserCommands
  )

  browserClear: RuntimeBrowserCommands['browserClear'] = this.browserCommands.browserClear.bind(
    this.browserCommands
  )

  browserSelectAll: RuntimeBrowserCommands['browserSelectAll'] =
    this.browserCommands.browserSelectAll.bind(this.browserCommands)

  browserKeypress: RuntimeBrowserCommands['browserKeypress'] =
    this.browserCommands.browserKeypress.bind(this.browserCommands)

  browserPdf: RuntimeBrowserCommands['browserPdf'] = this.browserCommands.browserPdf.bind(
    this.browserCommands
  )

  browserFullScreenshot: RuntimeBrowserCommands['browserFullScreenshot'] =
    this.browserCommands.browserFullScreenshot.bind(this.browserCommands)

  browserCookieGet: RuntimeBrowserCommands['browserCookieGet'] =
    this.browserCommands.browserCookieGet.bind(this.browserCommands)

  browserCookieSet: RuntimeBrowserCommands['browserCookieSet'] =
    this.browserCommands.browserCookieSet.bind(this.browserCommands)

  browserCookieDelete: RuntimeBrowserCommands['browserCookieDelete'] =
    this.browserCommands.browserCookieDelete.bind(this.browserCommands)

  browserSetViewport: RuntimeBrowserCommands['browserSetViewport'] =
    this.browserCommands.browserSetViewport.bind(this.browserCommands)

  browserSetGeolocation: RuntimeBrowserCommands['browserSetGeolocation'] =
    this.browserCommands.browserSetGeolocation.bind(this.browserCommands)

  browserInterceptEnable: RuntimeBrowserCommands['browserInterceptEnable'] =
    this.browserCommands.browserInterceptEnable.bind(this.browserCommands)

  browserInterceptDisable: RuntimeBrowserCommands['browserInterceptDisable'] =
    this.browserCommands.browserInterceptDisable.bind(this.browserCommands)

  browserInterceptList: RuntimeBrowserCommands['browserInterceptList'] =
    this.browserCommands.browserInterceptList.bind(this.browserCommands)

  browserCaptureStart: RuntimeBrowserCommands['browserCaptureStart'] =
    this.browserCommands.browserCaptureStart.bind(this.browserCommands)

  browserCaptureStop: RuntimeBrowserCommands['browserCaptureStop'] =
    this.browserCommands.browserCaptureStop.bind(this.browserCommands)

  browserConsoleLog: RuntimeBrowserCommands['browserConsoleLog'] =
    this.browserCommands.browserConsoleLog.bind(this.browserCommands)

  browserNetworkLog: RuntimeBrowserCommands['browserNetworkLog'] =
    this.browserCommands.browserNetworkLog.bind(this.browserCommands)

  browserDblclick: RuntimeBrowserCommands['browserDblclick'] =
    this.browserCommands.browserDblclick.bind(this.browserCommands)

  browserForward: RuntimeBrowserCommands['browserForward'] =
    this.browserCommands.browserForward.bind(this.browserCommands)

  browserScrollIntoView: RuntimeBrowserCommands['browserScrollIntoView'] =
    this.browserCommands.browserScrollIntoView.bind(this.browserCommands)

  browserGet: RuntimeBrowserCommands['browserGet'] = this.browserCommands.browserGet.bind(
    this.browserCommands
  )

  browserIs: RuntimeBrowserCommands['browserIs'] = this.browserCommands.browserIs.bind(
    this.browserCommands
  )

  browserKeyboardInsertText: RuntimeBrowserCommands['browserKeyboardInsertText'] =
    this.browserCommands.browserKeyboardInsertText.bind(this.browserCommands)

  browserMouseMove: RuntimeBrowserCommands['browserMouseMove'] =
    this.browserCommands.browserMouseMove.bind(this.browserCommands)

  browserMouseDown: RuntimeBrowserCommands['browserMouseDown'] =
    this.browserCommands.browserMouseDown.bind(this.browserCommands)

  browserMouseClick: RuntimeBrowserCommands['browserMouseClick'] =
    this.browserCommands.browserMouseClick.bind(this.browserCommands)

  browserMouseUp: RuntimeBrowserCommands['browserMouseUp'] =
    this.browserCommands.browserMouseUp.bind(this.browserCommands)

  browserMouseWheel: RuntimeBrowserCommands['browserMouseWheel'] =
    this.browserCommands.browserMouseWheel.bind(this.browserCommands)

  browserFind: RuntimeBrowserCommands['browserFind'] = this.browserCommands.browserFind.bind(
    this.browserCommands
  )

  browserSetDevice: RuntimeBrowserCommands['browserSetDevice'] =
    this.browserCommands.browserSetDevice.bind(this.browserCommands)

  browserSetOffline: RuntimeBrowserCommands['browserSetOffline'] =
    this.browserCommands.browserSetOffline.bind(this.browserCommands)

  browserSetHeaders: RuntimeBrowserCommands['browserSetHeaders'] =
    this.browserCommands.browserSetHeaders.bind(this.browserCommands)

  browserSetCredentials: RuntimeBrowserCommands['browserSetCredentials'] =
    this.browserCommands.browserSetCredentials.bind(this.browserCommands)

  browserSetMedia: RuntimeBrowserCommands['browserSetMedia'] =
    this.browserCommands.browserSetMedia.bind(this.browserCommands)

  browserClipboardRead: RuntimeBrowserCommands['browserClipboardRead'] =
    this.browserCommands.browserClipboardRead.bind(this.browserCommands)

  browserClipboardWrite: RuntimeBrowserCommands['browserClipboardWrite'] =
    this.browserCommands.browserClipboardWrite.bind(this.browserCommands)

  browserDialogAccept: RuntimeBrowserCommands['browserDialogAccept'] =
    this.browserCommands.browserDialogAccept.bind(this.browserCommands)

  browserDialogDismiss: RuntimeBrowserCommands['browserDialogDismiss'] =
    this.browserCommands.browserDialogDismiss.bind(this.browserCommands)

  browserStorageLocalGet: RuntimeBrowserCommands['browserStorageLocalGet'] =
    this.browserCommands.browserStorageLocalGet.bind(this.browserCommands)

  browserStorageLocalSet: RuntimeBrowserCommands['browserStorageLocalSet'] =
    this.browserCommands.browserStorageLocalSet.bind(this.browserCommands)

  browserStorageLocalClear: RuntimeBrowserCommands['browserStorageLocalClear'] =
    this.browserCommands.browserStorageLocalClear.bind(this.browserCommands)

  browserStorageSessionGet: RuntimeBrowserCommands['browserStorageSessionGet'] =
    this.browserCommands.browserStorageSessionGet.bind(this.browserCommands)

  browserStorageSessionSet: RuntimeBrowserCommands['browserStorageSessionSet'] =
    this.browserCommands.browserStorageSessionSet.bind(this.browserCommands)

  browserStorageSessionClear: RuntimeBrowserCommands['browserStorageSessionClear'] =
    this.browserCommands.browserStorageSessionClear.bind(this.browserCommands)

  browserDownload: RuntimeBrowserCommands['browserDownload'] =
    this.browserCommands.browserDownload.bind(this.browserCommands)

  browserHighlight: RuntimeBrowserCommands['browserHighlight'] =
    this.browserCommands.browserHighlight.bind(this.browserCommands)

  browserExec: RuntimeBrowserCommands['browserExec'] = this.browserCommands.browserExec.bind(
    this.browserCommands
  )

  browserTabCreate: RuntimeBrowserCommands['browserTabCreate'] =
    this.browserCommands.browserTabCreate.bind(this.browserCommands)

  browserTabSetProfile: RuntimeBrowserCommands['browserTabSetProfile'] =
    this.browserCommands.browserTabSetProfile.bind(this.browserCommands)

  browserTabProfileShow: RuntimeBrowserCommands['browserTabProfileShow'] =
    this.browserCommands.browserTabProfileShow.bind(this.browserCommands)

  browserTabProfileClone: RuntimeBrowserCommands['browserTabProfileClone'] =
    this.browserCommands.browserTabProfileClone.bind(this.browserCommands)

  browserProfileList: RuntimeBrowserCommands['browserProfileList'] =
    this.browserCommands.browserProfileList.bind(this.browserCommands)

  browserProfileCreate: RuntimeBrowserCommands['browserProfileCreate'] =
    this.browserCommands.browserProfileCreate.bind(this.browserCommands)

  browserProfileDelete: RuntimeBrowserCommands['browserProfileDelete'] =
    this.browserCommands.browserProfileDelete.bind(this.browserCommands)

  browserProfileDetectBrowsers: RuntimeBrowserCommands['browserProfileDetectBrowsers'] =
    this.browserCommands.browserProfileDetectBrowsers.bind(this.browserCommands)

  browserProfileImportFromBrowser: RuntimeBrowserCommands['browserProfileImportFromBrowser'] =
    this.browserCommands.browserProfileImportFromBrowser.bind(this.browserCommands)

  browserProfileClearDefaultCookies: RuntimeBrowserCommands['browserProfileClearDefaultCookies'] =
    this.browserCommands.browserProfileClearDefaultCookies.bind(this.browserCommands)

  browserTabClose: RuntimeBrowserCommands['browserTabClose'] =
    this.browserCommands.browserTabClose.bind(this.browserCommands)

  // Emulator bindings (delegated to dedicated commands for surface separation).
  emulatorTap: RuntimeEmulatorCommands['emulatorTap'] = this.emulatorCommands.emulatorTap.bind(
    this.emulatorCommands
  )
  emulatorGesture: RuntimeEmulatorCommands['emulatorGesture'] =
    this.emulatorCommands.emulatorGesture.bind(this.emulatorCommands)
  emulatorType: RuntimeEmulatorCommands['emulatorType'] = this.emulatorCommands.emulatorType.bind(
    this.emulatorCommands
  )
  emulatorButton: RuntimeEmulatorCommands['emulatorButton'] =
    this.emulatorCommands.emulatorButton.bind(this.emulatorCommands)
  emulatorRotate: RuntimeEmulatorCommands['emulatorRotate'] =
    this.emulatorCommands.emulatorRotate.bind(this.emulatorCommands)
  emulatorExec: RuntimeEmulatorCommands['emulatorExec'] = this.emulatorCommands.emulatorExec.bind(
    this.emulatorCommands
  )
  emulatorAttach: RuntimeEmulatorCommands['emulatorAttach'] =
    this.emulatorCommands.emulatorAttach.bind(this.emulatorCommands)
  emulatorList: RuntimeEmulatorCommands['emulatorList'] = this.emulatorCommands.emulatorList.bind(
    this.emulatorCommands
  )
  emulatorKill: RuntimeEmulatorCommands['emulatorKill'] = this.emulatorCommands.emulatorKill.bind(
    this.emulatorCommands
  )
  emulatorShutdown: RuntimeEmulatorCommands['emulatorShutdown'] =
    this.emulatorCommands.emulatorShutdown.bind(this.emulatorCommands)
  emulatorListSimulators: RuntimeEmulatorCommands['emulatorListSimulators'] =
    this.emulatorCommands.emulatorListSimulators.bind(this.emulatorCommands)
  emulatorAvailability: RuntimeEmulatorCommands['emulatorAvailability'] =
    this.emulatorCommands.emulatorAvailability.bind(this.emulatorCommands)
  emulatorListDevices: RuntimeEmulatorCommands['emulatorListDevices'] =
    this.emulatorCommands.emulatorListDevices.bind(this.emulatorCommands)
  emulatorInstall: RuntimeEmulatorCommands['emulatorInstall'] =
    this.emulatorCommands.emulatorInstall.bind(this.emulatorCommands)
  emulatorLaunch: RuntimeEmulatorCommands['emulatorLaunch'] =
    this.emulatorCommands.emulatorLaunch.bind(this.emulatorCommands)
  emulatorPermissions: RuntimeEmulatorCommands['emulatorPermissions'] =
    this.emulatorCommands.emulatorPermissions.bind(this.emulatorCommands)
  emulatorAx: RuntimeEmulatorCommands['emulatorAx'] = this.emulatorCommands.emulatorAx.bind(
    this.emulatorCommands
  )
  emulatorLogcat: RuntimeEmulatorCommands['emulatorLogcat'] =
    this.emulatorCommands.emulatorLogcat.bind(this.emulatorCommands)
  emulatorUnregisterActive: RuntimeEmulatorCommands['emulatorUnregisterActive'] =
    this.emulatorCommands.emulatorUnregisterActive.bind(this.emulatorCommands)
}
