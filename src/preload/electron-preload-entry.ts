import { contextBridge } from './preload-api-runtime-context'
import { electronAPI } from './preload-api-runtime-context'
import { createPreloadApiApp } from './preload-api-app'
import { createPreloadApiPty } from './preload-api-pty'
import { createPreloadApiGithub } from './preload-api-github'
import { createPreloadApiLinear } from './preload-api-linear'
import { createPreloadApiAgentHooks } from './preload-api-agent-hooks'
import { createPreloadApiBrowser } from './preload-api-browser'
import { createPreloadApiHooks } from './preload-api-hooks'
import { createPreloadApiGit } from './preload-api-git'
import { createPreloadApiUi } from './preload-api-ui'
import { createPreloadApiStats } from './preload-api-stats'
import { createPreloadApiSsh } from './preload-api-ssh'
import type { PreloadApi } from './api-preload-surface'

const api = Object.assign({}, createPreloadApiApp(), createPreloadApiPty(), createPreloadApiGithub(), createPreloadApiLinear(), createPreloadApiAgentHooks(), createPreloadApiBrowser(), createPreloadApiHooks(), createPreloadApiGit(), createPreloadApiUi(), createPreloadApiStats(), createPreloadApiSsh()) as PreloadApi

// Expose Electron APIs via contextBridge when context-isolated, otherwise attach to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
