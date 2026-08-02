import { readdir, stat } from 'node:fs/promises'
import { basename, isAbsolute, join } from 'node:path'
import { resolveOpenCodeDataDirectory } from '../opencode/opencode-data-directory'
import Database from '../sqlite/sync-database'
import { columnExists, tableExists } from './schema-helpers'
import type { OpenCodeUsageProcessedDatabase } from './types'

export type OpenCodeUsageRow = {
  id: string
  session_id: string
  time_created: number
  time_updated: number | null
  data: string
  directory: string | null
  title: string | null
  worktree: string | null
  session_model: string | null
}

type OpenCodeSessionUsageRow = {
  id: string
  session_id: string
  time_created: number
  time_updated: number | null
  directory: string | null
  title: string | null
  worktree: string | null
  session_model: string | null
  cost: number
  tokens_input: number
  tokens_output: number
  tokens_reasoning: number
  tokens_cache_read: number
}

export async function listOpenCodeDatabases(): Promise<string[]> {
  const dataDirectory = resolveOpenCodeDataDirectory()
  const databaseOverride = getOpenCodeDatabaseOverride(dataDirectory)
  if (databaseOverride.isConfigured) {
    if (!databaseOverride.path) {
      return []
    }
    try {
      return (await stat(databaseOverride.path)).isFile() ? [databaseOverride.path] : []
    } catch {
      return []
    }
  }

  try {
    const entries = await readdir(dataDirectory, { withFileTypes: true })
    return entries
      .filter((entry) => entry.isFile() && /^opencode(?:-[A-Za-z0-9_.-]+)?\.db$/.test(entry.name))
      .map((entry) => join(dataDirectory, entry.name))
      .sort()
  } catch {
    return []
  }
}

function compareOpenCodeClaimPriority(left: string, right: string): number {
  // Why: the canonical opencode.db is the live database; it must claim
  // duplicated sessions ahead of stale sibling copies. Remaining ties use
  // path order so ownership is deterministic across rescans.
  const leftRank = basename(left).toLowerCase() === 'opencode.db' ? 0 : 1
  const rightRank = basename(right).toLowerCase() === 'opencode.db' ? 0 : 1
  if (leftRank !== rightRank) {
    return leftRank - rightRank
  }
  return left < right ? -1 : left > right ? 1 : 0
}

export async function getProcessedDatabaseInfo(
  dbPath: string
): Promise<OpenCodeUsageProcessedDatabase> {
  const dbStat = await stat(dbPath)
  return {
    path: dbPath,
    mtimeMs: dbStat.mtimeMs,
    size: dbStat.size
  }
}

function getProjectJoin(db: Database.Database): string {
  return tableExists(db, 'project') && columnExists(db, 'session', 'project_id')
    ? 'LEFT JOIN project p ON p.id = s.project_id'
    : 'LEFT JOIN (SELECT NULL AS id, NULL AS worktree) p ON 1 = 0'
}

function getSessionModelSelect(db: Database.Database): string {
  return columnExists(db, 'session', 'model') ? 's.model AS session_model' : 'NULL AS session_model'
}

function getAssistantSessionMessageCount(db: Database.Database): number {
  if (!tableExists(db, 'session_message')) {
    return 0
  }
  const assistantPredicate = columnExists(db, 'session_message', 'type')
    ? "type = 'assistant' AND json_extract(data, '$.tokens.input') IS NOT NULL"
    : "json_extract(data, '$.tokens.input') IS NOT NULL"
  const row = db
    .prepare(`SELECT COUNT(*) AS count FROM session_message WHERE ${assistantPredicate}`)
    .get() as { count?: number } | undefined
  return row?.count ?? 0
}

function canReadSessionUsageRows(db: Database.Database): boolean {
  if (!tableExists(db, 'session')) {
    return false
  }
  return ['cost', 'tokens_input', 'tokens_output', 'tokens_reasoning', 'tokens_cache_read'].every(
    (columnName) => columnExists(db, 'session', columnName)
  )
}

function getSessionUsageRowCount(db: Database.Database): number {
  if (!canReadSessionUsageRows(db)) {
    return 0
  }
  const row = db
    .prepare(
      `SELECT COUNT(*) AS count
       FROM session
       WHERE tokens_input + tokens_output + tokens_reasoning + tokens_cache_read > 0`
    )
    .get() as { count?: number } | undefined
  return row?.count ?? 0
}

function selectSessionUsageRows(db: Database.Database): OpenCodeUsageRow[] {
  const projectJoin = getProjectJoin(db)
  const sessionModelSelect = getSessionModelSelect(db)
  const rows = db
    .prepare(
      `SELECT s.id, s.id AS session_id, s.time_created, s.time_updated,
              s.directory, s.title, p.worktree, ${sessionModelSelect},
              s.cost, s.tokens_input, s.tokens_output, s.tokens_reasoning, s.tokens_cache_read
       FROM session s
       ${projectJoin}
       WHERE s.tokens_input + s.tokens_output + s.tokens_reasoning + s.tokens_cache_read > 0
       ORDER BY s.time_created, s.id`
    )
    .all() as OpenCodeSessionUsageRow[]

  return rows.map((row) => ({
    id: row.id,
    session_id: row.session_id,
    time_created: row.time_created,
    time_updated: row.time_updated,
    directory: row.directory,
    title: row.title,
    worktree: row.worktree,
    session_model: row.session_model,
    data: JSON.stringify({
      cost: row.cost,
      tokens: {
        input: row.tokens_input,
        output: row.tokens_output,
        reasoning: row.tokens_reasoning,
        total: row.tokens_input + row.tokens_output + row.tokens_reasoning,
        cache: {
          read: row.tokens_cache_read,
          write: 0
        }
      }
    })
  }))
}

function selectUsageRows(db: Database.Database): OpenCodeUsageRow[] {
  if (!tableExists(db, 'session')) {
    return []
  }

  // Why: newer OpenCode DBs maintain session-level token/cost totals. Reading
  // one aggregate row per session is faster than parsing every message blob.
  if (getSessionUsageRowCount(db) > 0) {
    return selectSessionUsageRows(db)
  }

  const projectJoin = getProjectJoin(db)
  const sessionModelSelect = getSessionModelSelect(db)

  if (getAssistantSessionMessageCount(db) > 0) {
    const assistantPredicate = columnExists(db, 'session_message', 'type')
      ? "sm.type = 'assistant'"
      : "json_extract(sm.data, '$.tokens.input') IS NOT NULL"
    return db
      .prepare(
        `SELECT sm.id, sm.session_id, sm.time_created, sm.time_updated, sm.data,
                s.directory, s.title, p.worktree, ${sessionModelSelect}
         FROM session_message sm
         JOIN session s ON s.id = sm.session_id
         ${projectJoin}
         WHERE ${assistantPredicate}
         ORDER BY sm.time_created, sm.id`
      )
      .all() as OpenCodeUsageRow[]
  }

  if (!tableExists(db, 'message')) {
    return []
  }

  return db
    .prepare(
      `SELECT m.id, m.session_id, m.time_created, m.time_updated, m.data,
              s.directory, s.title, p.worktree, ${sessionModelSelect}
       FROM message m
       JOIN session s ON s.id = m.session_id
       ${projectJoin}
       WHERE json_extract(m.data, '$.role') = 'assistant'
       ORDER BY m.time_created, m.id`
    )
    .all() as OpenCodeUsageRow[]
}


export { compareOpenCodeClaimPriority }
