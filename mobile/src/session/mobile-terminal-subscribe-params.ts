export type MobileTerminalViewport = { cols: number; rows: number }

export function buildMobileTerminalSubscribeParams(
  terminal: string,
  deviceId: string,
  viewport: MobileTerminalViewport | null
) {
  return {
    terminal,
    client: { id: deviceId, type: 'mobile' as const },
    capabilities: { terminalBinaryStream: 1 as const },
    ...(viewport ? { viewport } : {})
  }
}
