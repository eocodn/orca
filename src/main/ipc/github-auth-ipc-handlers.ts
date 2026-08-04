// Hosted source-control IPC handlers.
import { ipcMain } from 'electron'
import { appStarSourceSchema } from '../../shared/gh-star-source'
import { diagnoseGhAuth } from '../github/auth-diagnose'
import {
  checkOrcaStarred,
  getAuthenticatedViewer,
  starOrca
} from '../github/client'
import { getRateLimit } from '../github/rate-limit'
import type { Store } from '../persistence'
import type { StatsCollector } from '../stats/collector'
import { track } from '../telemetry/client'
import { getCohortAtEmit } from '../telemetry/cohort-classifier'

export function registerGitHubAuthHandlers(store: Store, stats: StatsCollector): void {
  ipcMain.handle('gh:viewer', () => getAuthenticatedViewer())

  ipcMain.handle('gh:checkOrcaStarred', () => checkOrcaStarred())

  ipcMain.handle('gh:starOrca', async (_event, source: unknown) => {
      const sourceParse = appStarSourceSchema.safeParse(source)
      const starred = await starOrca()
      if (starred && sourceParse.success) {
        // Why: this main-owned event bypasses renderer telemetry IPC, so cohort
        // context must be attached here on the successful star path.
        track('app_starred_orca', {
          source: sourceParse.data,
          ...getCohortAtEmit()
        })
      }
      return starred
    })
  
    // Why: `rate_limit` is exempt from GitHub's rate-limit accounting, so
    // polling is cheap. A 30s in-process cache still avoids the gh subprocess
    // cost on every render — see getRateLimit for the ttl rationale. Force
    // parameter lets the renderer bust the cache after a known-expensive op
    // (e.g. post-ProjectPicker discovery) without waiting out the ttl.

  ipcMain.handle('gh:rateLimit', (_event, args?: { force?: boolean }) =>
      getRateLimit(args?.force ? { force: true } : undefined)
    )

  ipcMain.handle('gh:diagnoseAuth', (_event, args?: { host?: string }) =>
      diagnoseGhAuth(args?.host)
    )
  
    // ── GitHub ProjectV2 view handlers ─────────────────────────────────
    // Why: registered unconditionally so enabling the experimental flag at
    // runtime takes effect without a restart. The renderer gates entry points.
    // Handlers never throw across IPC — every failure mode resolves through the
    // GitHubProjectViewError envelope.
}
