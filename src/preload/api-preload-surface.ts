
import type { PreloadApiApp } from './preload-api-contract-app'
import type { PreloadApiPty } from './preload-api-contract-pty'
import type { PreloadApiGithub } from './preload-api-contract-github'
import type { PreloadApiLinear } from './preload-api-contract-linear'
import type { PreloadApiAgentHooks } from './preload-api-contract-agent-hooks'
import type { PreloadApiBrowser } from './preload-api-contract-browser'
import type { PreloadApiHooks } from './preload-api-contract-hooks'
import type { PreloadApiGit } from './preload-api-contract-git'
import type { PreloadApiUi } from './preload-api-contract-ui'

export type PreloadApi = PreloadApiApp
  & PreloadApiPty
  & PreloadApiGithub
  & PreloadApiLinear
  & PreloadApiAgentHooks
  & PreloadApiBrowser
  & PreloadApiHooks
  & PreloadApiGit
  & PreloadApiUi
