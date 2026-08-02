import type { ConnectionState } from './types'

export type ConnectionStateAccessors = {
  getState: () => ConnectionState
  setState: (state: ConnectionState) => void
  getIntentionallyClosed: () => boolean
  setIntentionallyClosed: (value: boolean) => void
  getReconnectTimer: () => ReturnType<typeof setTimeout> | null
  setReconnectTimer: (value: ReturnType<typeof setTimeout> | null) => void
  getWs: () => WebSocket | null
  setWs: (value: WebSocket | null) => void
  getSharedKey: () => Uint8Array | null
  setSharedKey: (value: Uint8Array | null) => void
  getReconnectAttempt: () => number
  setReconnectAttempt: (value: number) => void
  getConnectTimer: () => ReturnType<typeof setTimeout> | null
  setConnectTimer: (value: ReturnType<typeof setTimeout> | null) => void
  getHandshakeTimer: () => ReturnType<typeof setTimeout> | null
  setHandshakeTimer: (value: ReturnType<typeof setTimeout> | null) => void
}

export function createConnectionStateAccessors(accessors: ConnectionStateAccessors) {
  return {
    get state() {
      return accessors.getState()
    },
    set state(value: ConnectionState) {
      accessors.setState(value)
    },
    get intentionallyClosed() {
      return accessors.getIntentionallyClosed()
    },
    set intentionallyClosed(value: boolean) {
      accessors.setIntentionallyClosed(value)
    },
    get reconnectTimer() {
      return accessors.getReconnectTimer()
    },
    set reconnectTimer(value: ReturnType<typeof setTimeout> | null) {
      accessors.setReconnectTimer(value)
    },
    get ws() {
      return accessors.getWs()
    },
    set ws(value: WebSocket | null) {
      accessors.setWs(value)
    },
    get sharedKey() {
      return accessors.getSharedKey()
    },
    set sharedKey(value: Uint8Array | null) {
      accessors.setSharedKey(value)
    },
    get reconnectAttempt() {
      return accessors.getReconnectAttempt()
    },
    set reconnectAttempt(value: number) {
      accessors.setReconnectAttempt(value)
    },
    get connectTimer() {
      return accessors.getConnectTimer()
    },
    set connectTimer(value: ReturnType<typeof setTimeout> | null) {
      accessors.setConnectTimer(value)
    },
    get handshakeTimer() {
      return accessors.getHandshakeTimer()
    },
    set handshakeTimer(value: ReturnType<typeof setTimeout> | null) {
      accessors.setHandshakeTimer(value)
    }
  }
}

export type SocketSessionValues = {
  getWs: () => WebSocket | null
  setWs: (value: WebSocket | null) => void
  getState: () => ConnectionState
  setState: (value: ConnectionState) => void
  getReconnectAttempt: () => number
  setReconnectAttempt: (value: number) => void
  getReconnectTimer: () => ReturnType<typeof setTimeout> | null
  setReconnectTimer: (value: ReturnType<typeof setTimeout> | null) => void
  getConnectTimer: () => ReturnType<typeof setTimeout> | null
  setConnectTimer: (value: ReturnType<typeof setTimeout> | null) => void
  getHandshakeTimer: () => ReturnType<typeof setTimeout> | null
  setHandshakeTimer: (value: ReturnType<typeof setTimeout> | null) => void
  getActivityProbeTimer: () => ReturnType<typeof setInterval> | null
  setActivityProbeTimer: (value: ReturnType<typeof setInterval> | null) => void
  getActivityProbeInFlight: () => boolean
  setActivityProbeInFlight: (value: boolean) => void
  getIntentionallyClosed: () => boolean
  setIntentionallyClosed: (value: boolean) => void
  getAuthRejectionCount: () => number
  setAuthRejectionCount: (value: number) => void
  getAuthenticationGeneration: () => number
  setAuthenticationGeneration: (value: number) => void
  getLastConnectedAt: () => number | null
  setLastConnectedAt: (value: number | null) => void
  getLastInboundAt: () => number | null
  setLastInboundAt: (value: number | null) => void
  getInboundSequence: () => number
  setInboundSequence: (value: number) => void
  getLastWsClosedAt: () => number | null
  setLastWsClosedAt: (value: number | null) => void
  getWsConstructionCounter: () => number
  setWsConstructionCounter: (value: number) => void
  getSharedKey: () => Uint8Array | null
  setSharedKey: (value: Uint8Array | null) => void
}

export function createSocketSessionAccessors(values: SocketSessionValues) {
  return {
    get ws() { return values.getWs() }, set ws(value: WebSocket | null) { values.setWs(value) },
    get state() { return values.getState() }, set state(value: ConnectionState) { values.setState(value) },
    get reconnectAttempt() { return values.getReconnectAttempt() }, set reconnectAttempt(value: number) { values.setReconnectAttempt(value) },
    get reconnectTimer() { return values.getReconnectTimer() }, set reconnectTimer(value: ReturnType<typeof setTimeout> | null) { values.setReconnectTimer(value) },
    get connectTimer() { return values.getConnectTimer() }, set connectTimer(value: ReturnType<typeof setTimeout> | null) { values.setConnectTimer(value) },
    get handshakeTimer() { return values.getHandshakeTimer() }, set handshakeTimer(value: ReturnType<typeof setTimeout> | null) { values.setHandshakeTimer(value) },
    get activityProbeTimer() { return values.getActivityProbeTimer() }, set activityProbeTimer(value: ReturnType<typeof setInterval> | null) { values.setActivityProbeTimer(value) },
    get activityProbeInFlight() { return values.getActivityProbeInFlight() }, set activityProbeInFlight(value: boolean) { values.setActivityProbeInFlight(value) },
    get intentionallyClosed() { return values.getIntentionallyClosed() }, set intentionallyClosed(value: boolean) { values.setIntentionallyClosed(value) },
    get authRejectionCount() { return values.getAuthRejectionCount() }, set authRejectionCount(value: number) { values.setAuthRejectionCount(value) },
    get authenticationGeneration() { return values.getAuthenticationGeneration() }, set authenticationGeneration(value: number) { values.setAuthenticationGeneration(value) },
    get lastConnectedAt() { return values.getLastConnectedAt() }, set lastConnectedAt(value: number | null) { values.setLastConnectedAt(value) },
    get lastInboundAt() { return values.getLastInboundAt() }, set lastInboundAt(value: number | null) { values.setLastInboundAt(value) },
    get inboundSequence() { return values.getInboundSequence() }, set inboundSequence(value: number) { values.setInboundSequence(value) },
    get lastWsClosedAt() { return values.getLastWsClosedAt() }, set lastWsClosedAt(value: number | null) { values.setLastWsClosedAt(value) },
    get wsConstructionCounter() { return values.getWsConstructionCounter() }, set wsConstructionCounter(value: number) { values.setWsConstructionCounter(value) },
    get sharedKey() { return values.getSharedKey() }, set sharedKey(value: Uint8Array | null) { values.setSharedKey(value) }
  }
}