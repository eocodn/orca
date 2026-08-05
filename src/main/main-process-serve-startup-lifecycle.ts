import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import type { OrcaRuntimeService } from './runtime/orca-runtime'
import type { OrcaRuntimeRpcServer } from './runtime/runtime-rpc'
import { resolveAdvertisedPairingEndpoint } from './runtime/pairing-endpoint'
import { notifyServeSupervisorReady } from './serve-update-handoff'
import type { ServeReadinessPublisher } from './server/serve-readiness'

export type ServeOptions = {
  json: boolean
  wsPort?: number
  pairingAddress: string | null
  noPairing: boolean
  mobilePairing: boolean
}

export type ServeReadinessContext = {
  runtime: OrcaRuntimeService | null
  runtimeRpc: OrcaRuntimeRpcServer | null
  readinessPublisher: ServeReadinessPublisher
  managedWslCliReconciliationStatus: 'pending' | 'settled' | 'failed'
}

export function getServeOptions(argv = process.argv): ServeOptions {
  const valueAfter = (flag: string): string | null => {
    const index = argv.indexOf(flag)
    if (index === -1) {
      return null
    }
    const value = argv[index + 1]
    return value && !value.startsWith('--') ? value : null
  }
  const rawPort = valueAfter('--serve-port')
  let wsPort: number | undefined
  if (rawPort) {
    const parsedPort = Number(rawPort)
    if (!Number.isInteger(parsedPort) || parsedPort < 0 || parsedPort > 65535) {
      throw new Error(`Invalid --serve-port value: ${rawPort}`)
    }
    wsPort = parsedPort
  }
  return {
    json: argv.includes('--serve-json'),
    ...(wsPort !== undefined ? { wsPort } : {}),
    pairingAddress: valueAfter('--serve-pairing-address'),
    noPairing: argv.includes('--serve-no-pairing'),
    mobilePairing: argv.includes('--serve-mobile-pairing'),
  }
}

export function getBundledWebClientRoot(): string | undefined {
  const appPath = app.getAppPath()
  const roots = [
    join(appPath, 'out', 'web'),
    // Unpacked electron-vite entrypoints place the web bundle next to out/main.
    join(appPath, '..', 'web')
  ]
  return roots.find((root) => existsSync(join(root, 'web-index.html')))
}

async function renderTerminalPairingQr(pairingUrl: string): Promise<string | null> {
  // Keep qrcode out of the common launch path for users who never pair a device.
  const QRCode = await import('qrcode')
  try {
    return await QRCode.toString(pairingUrl, { type: 'terminal', small: true })
  } catch {
    try {
      return await QRCode.toString(pairingUrl, { type: 'utf8' })
    } catch {
      return null
    }
  }
}

export async function printServeReady(
  options: ServeOptions,
  context: ServeReadinessContext
): Promise<void> {
  const { runtime, runtimeRpc, readinessPublisher, managedWslCliReconciliationStatus } = context
  if (!runtime || !runtimeRpc) {
    throw new Error('Runtime server must be initialized before printing serve readiness')
  }
  const boundEndpoint = runtimeRpc.getWebSocketEndpoint()
  const advertised = boundEndpoint
    ? resolveAdvertisedPairingEndpoint(boundEndpoint, options.pairingAddress)
    : null
  const pairing = options.noPairing
    ? ({
        available: false,
        reason: 'disabled_by_operator',
        guidance: 'Restart without --no-pairing to create a client pairing offer.'
      } as const)
    : runtimeRpc.createPairingOffer({
        address: options.pairingAddress,
        name: `${options.mobilePairing ? 'Mobile' : 'CLI'} ${new Date().toLocaleDateString()}`,
        scope: options.mobilePairing ? 'mobile' : 'runtime'
      })
  const pairingQr =
    pairing.available && options.mobilePairing
      ? await renderTerminalPairingQr(pairing.pairingUrl)
      : null
  await readinessPublisher.publish(
    {
      runtimeId: runtime.getRuntimeId(),
      boundEndpoint,
      advertisedEndpoint: advertised?.ok ? advertised.endpoint : null,
      managedWslCliReconciliation: managedWslCliReconciliationStatus,
      pairing: pairing.available
        ? {
            available: true,
            url: pairing.pairingUrl,
            endpoint: pairing.endpoint,
            deviceId: pairing.deviceId,
            webClientUrl: pairing.webClientUrl,
            scope: options.mobilePairing ? 'mobile' : 'runtime',
            qr: pairingQr
          }
        : pairing
    },
    { mode: options.json ? 'json' : 'human' }
  )
  notifyServeSupervisorReady(runtime.getRuntimeId())
}

export function installServeSignalHandlers(): void {
  const quit = (): void => {
    app.quit()
  }
  process.once('SIGINT', quit)
  process.once('SIGTERM', quit)
}
