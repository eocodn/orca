import { useLayoutEffect, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, Copy } from 'lucide-react'
import { cn } from '../../lib/utils'
import type { MobileNetworkInterface } from '../settings/mobile-network-interface-selection'
import { AndroidLogo } from './MobileBrandIcons'
import type { InstallCopy } from './mobile-platform-copy'
import type { MobilePairingConnectionMode } from '../../../../shared/mobile-pairing-connection-mode'
import type { MobileRelayMintFailure } from '../../../../shared/mobile-relay-mint-failure'
import { MobileHeroPairingStep } from './MobileHeroPairingStep'
export { HeroIntro } from './MobileHeroIntro'
export { HeroPaired, type PairedDevice } from './MobileHeroPairedDevices'
import { translate } from '@/i18n/i18n'

export type StepIndex = 0 | 1

type HeroFlowProps = {
  stepIdx: StepIndex
  installQrUrl: string | null
  installCopy: InstallCopy
  onOpenInstallUrl: () => void
  onCopyInstallUrl: () => void
  pairQrDataUrl: string | null
  pairingUrl: string | null
  pairingQrError: boolean
  relayMintFailure: MobileRelayMintFailure | null
  onUseLan: () => void
  onRetryRelay: () => void
  onCopyRelayDiagnostics: () => void
  pairLoading: boolean
  connectionMode: MobilePairingConnectionMode
  onConnectionModeChange: (mode: MobilePairingConnectionMode) => void
  onRegeneratePairing: () => void
  canGeneratePairing: boolean
  onCopyPairingCode: () => void
  networkInterfaces: readonly MobileNetworkInterface[]
  selectedAddress: string | undefined
  onSelectedAddressChange: (address: string) => void
  beforeCustomAddressChange: (address: string) => Promise<boolean>
  onRefreshNetworkInterfaces: () => void
  refreshingNetworkInterfaces: boolean
  onBack: () => void
  onContinue: () => void
  onDone?: () => void
}

export function HeroFlow({
  stepIdx,
  installQrUrl,
  installCopy,
  onOpenInstallUrl,
  onCopyInstallUrl,
  pairQrDataUrl,
  pairingUrl,
  pairingQrError,
  relayMintFailure,
  onUseLan,
  onRetryRelay,
  onCopyRelayDiagnostics,
  pairLoading,
  connectionMode,
  onConnectionModeChange,
  onRegeneratePairing,
  canGeneratePairing,
  onCopyPairingCode,
  networkInterfaces,
  selectedAddress,
  onSelectedAddressChange,
  beforeCustomAddressChange,
  onRefreshNetworkInterfaces,
  refreshingNetworkInterfaces,
  onBack,
  onContinue,
  onDone
}: HeroFlowProps): React.JSX.Element {
  const isLast = stepIdx === 1
  const screenRefs = useRef<(HTMLDivElement | null)[]>([])
  const [viewportHeight, setViewportHeight] = useState<number>()

  useLayoutEffect(() => {
    const activeScreen = screenRefs.current[stepIdx]
    if (!activeScreen) {
      return
    }

    const measure = (): void => setViewportHeight(activeScreen.scrollHeight)
    measure()

    if (typeof ResizeObserver === 'undefined') {
      return
    }
    const observer = new ResizeObserver(measure)
    observer.observe(activeScreen)
    return () => observer.disconnect()
  }, [stepIdx])

  return (
    <div className="mp-flow-card">
      <div
        className="mp-flow-viewport"
        style={viewportHeight === undefined ? undefined : { height: viewportHeight }}
      >
        <div
          ref={(element) => {
            screenRefs.current[0] = element
          }}
          className={cn('mp-flow-screen', stepIdx === 0 ? 'is-active' : 'is-past')}
          aria-hidden={stepIdx !== 0}
          inert={stepIdx !== 0}
        >
          <div className="mp-step2-layout">
            <div className="mp-step2-copy">
              <div className="mp-eyebrow-row">
                <div className="mp-step-num">{stepIdx + 1}</div>
                <span className="mp-eyebrow">
                  {translate('auto.components.mobile.MobileHero.92ddfdfa1f', 'Step 1 of 2')}
                </span>
              </div>
              <h2 className="mp-h2">
                {translate('auto.components.mobile.MobileHero.0d9b33299e', 'Get the app.')}
              </h2>
              <p className="mp-lead-sm">
                {translate(
                  'auto.components.mobile.MobileHero.e75647ace0',
                  'Scan the QR with your phone or open the install link to grab Orca Mobile.'
                )}
              </p>
              <div className="mp-platform-badge">
                <AndroidLogo />
                {translate('auto.components.mobile.MobileHero.ac1eb64952', 'Android')}
              </div>
              <div className="mp-inline-actions">
                <button type="button" className="mp-ghost-action" onClick={onOpenInstallUrl}>
                  {installCopy.ctaLabel}
                </button>
                <button type="button" className="mp-text-link" onClick={onCopyInstallUrl}>
                  <Copy className="size-3.5" />
                  {translate('auto.components.mobile.MobileHero.aa97420ba4', 'Copy install link')}
                </button>
              </div>
            </div>
            <div className="mp-qr mp-qr-large">
              {installQrUrl ? (
                <img
                  src={installQrUrl}
                  alt={translate('auto.components.mobile.MobileHero.3241f3c26a', 'Install QR')}
                />
              ) : null}
            </div>
          </div>
        </div>

        <div
          ref={(element) => {
            screenRefs.current[1] = element
          }}
          className={cn('mp-flow-screen', stepIdx === 1 && 'is-active')}
          aria-hidden={stepIdx !== 1}
          inert={stepIdx !== 1}
        >
          <MobileHeroPairingStep
            pairQrDataUrl={pairQrDataUrl}
            pairingUrl={pairingUrl}
            pairingQrError={pairingQrError}
            relayMintFailure={relayMintFailure}
            onUseLan={onUseLan}
            onRetryRelay={onRetryRelay}
            onCopyRelayDiagnostics={onCopyRelayDiagnostics}
            pairLoading={pairLoading}
            connectionMode={connectionMode}
            onConnectionModeChange={onConnectionModeChange}
            onRegeneratePairing={onRegeneratePairing}
            canGeneratePairing={canGeneratePairing}
            onCopyPairingCode={onCopyPairingCode}
            networkInterfaces={networkInterfaces}
            selectedAddress={selectedAddress}
            onSelectedAddressChange={onSelectedAddressChange}
            beforeCustomAddressChange={beforeCustomAddressChange}
            onRefreshNetworkInterfaces={onRefreshNetworkInterfaces}
            refreshingNetworkInterfaces={refreshingNetworkInterfaces}
          />
        </div>
      </div>

      <div className="mp-flow-actions">
        <button type="button" className="mp-flow-back" onClick={onBack}>
          <ArrowLeft className="size-3" />
          {translate('auto.components.mobile.MobileHero.b622eba64d', 'Back')}
        </button>
        {isLast ? (
          onDone ? (
            <button
              type="button"
              className="mp-primary-action mp-flow-primary-action"
              onClick={onDone}
            >
              {translate('auto.components.mobile.MobileHero.3f90dbd274', 'Done')}
              <ArrowRight className="size-3.5" />
            </button>
          ) : (
            <span />
          )
        ) : (
          <button
            type="button"
            className="mp-flow-continue mp-flow-primary-action"
            onClick={onContinue}
          >
            {translate('auto.components.mobile.MobileHero.a8fb43cf1c', 'Continue')}
            <ArrowRight className="size-3.5" />
          </button>
        )}
      </div>
    </div>
  )
}
