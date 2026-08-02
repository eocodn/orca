import net from 'node:net'
import os from 'node:os'

const METRO_PORT_SEARCH_LIMIT = 100

export function lanIpCandidates() {
  return Object.entries(os.networkInterfaces()).flatMap(([name, interfaces]) =>
    (interfaces || []).map((iface) => ({ name, iface }))
  ).filter(({ name, iface }) => iface && iface.family === 'IPv4' && !iface.internal && !iface.address.startsWith('169.254.') && !/^(awdl|bridge|gif|llw|p2p|stf|utun)/.test(name))
    .sort((a, b) => interfaceRank(a.name) - interfaceRank(b.name)).map(({ iface }) => iface.address)
}
function interfaceRank(name) { return /^(en|eth|wlan)/.test(name) ? 0 : 1 }
function isLoopbackHost(hostname) { return ['localhost', '127.0.0.1', '0.0.0.0'].includes(hostname) }
export function normalizeMetroUrl(rawUrl) {
  try {
    const url = new URL(rawUrl)
    const lanIp = lanIpCandidates()[0]
    if (lanIp && isLoopbackHost(url.hostname)) url.hostname = lanIp
    return url.toString().replace(/\/$/, '')
  } catch { return rawUrl }
}
export function metroUrlCandidates(initialUrl) {
  try {
    const url = new URL(initialUrl)
    return [...new Set([url.hostname, ...lanIpCandidates(), 'localhost', '127.0.0.1'])].map((host) => {
      const candidate = new URL(url.toString()); candidate.hostname = host
      return candidate.toString().replace(/\/$/, '')
    })
  } catch { return [initialUrl] }
}
export function devClientUrlForMetroUrl(url) { return `exp+orca-mobile://expo-development-client/?url=${encodeURIComponent(url)}` }
function canListenOnPort(port) {
  return new Promise((resolve, reject) => {
    const server = net.createServer(); server.unref()
    server.on('error', (error) => error.code === 'EADDRINUSE' || error.code === 'EACCES' ? resolve(false) : reject(error))
    server.listen({ port, host: '0.0.0.0' }, () => server.close(() => resolve(true)))
  })
}
export async function findAvailableMetroPort(startPort) {
  for (let port = startPort; port < startPort + METRO_PORT_SEARCH_LIMIT; port++) if (await canListenOnPort(port)) return port
  throw new Error(`No available Metro port found from ${startPort} to ${startPort + METRO_PORT_SEARCH_LIMIT - 1}`)
}
export async function resolveMetroPort(options) {
  if (options.port) {
    const requestedPort = Number(options.port)
    if (!Number.isInteger(requestedPort) || requestedPort <= 0 || requestedPort > 65535) throw new Error(`Invalid Metro port: ${options.port}`)
    return requestedPort
  }
  return findAvailableMetroPort(8081)
}
export async function verifyMetro(url) {
  const urlObj = new URL(url); const statusUrl = new URL('/status', `${urlObj.protocol}//${urlObj.host}`).toString()
  const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 5000)
  try { return (await (await fetch(statusUrl, { signal: controller.signal })).text()).includes('packager-status:running') }
  catch { return false } finally { clearTimeout(timeout) }
}
export async function findReachableMetroUrl(initialUrl) {
  for (const candidate of metroUrlCandidates(initialUrl)) if (await verifyMetro(candidate)) return { url: candidate, reachable: true }
  return { url: initialUrl, reachable: false }
}
