import type { TuiAgent } from './types'
import { assertJsonTextStructureWithinLimits } from './json-text-structure-limit'

/* eslint-disable max-lines -- Why: this is the single registry for non-interactive commit-message agents, their model discovery parsers, and UI capabilities. */

// Why: this file is the source of truth for non-interactive agent invocation
// (commit-message generation). It is intentionally separate from
// `tui-agent-config.ts`, which describes interactive PTY launching — mixing
// the two confuses both code paths.

export type ThinkingLevel = { id: string; label: string }

export type CommitMessageModel = {
  /** Value passed to the agent CLI's --model flag. */
  id: string
  /** Visible label in the model dropdown. */
  label: string
  /** Omit when the model does not expose an effort selector — the UI then hides the dropdown. */
  thinkingLevels?: ThinkingLevel[]
  /** Required when thinkingLevels is present. */
  defaultThinkingLevel?: string
}

export type CommitMessageAgentSpec = {
  id: TuiAgent
  /** Visible label in the agent dropdown. */
  label: string
  /** Binary spawned in non-interactive mode. */
  binary: string
  /** Where the prompt is delivered. Large diffs go via stdin to avoid argv limits. */
  promptDelivery: 'argv' | 'stdin'
  buildArgs: (params: { prompt: string; model: string; thinkingLevel?: string }) => string[]
  /** Whether the model list is static or discovered from the agent CLI. */
  modelSource: 'static' | 'dynamic'
  /** Command used by the main process to discover models when modelSource is dynamic. */
  modelDiscovery?: {
    binary: string
    args: string[]
    parse: (stdout: string) => CommitMessageModel[]
  }
  models: CommitMessageModel[]
  defaultModelId: string
}

export type CommitMessageModelCapability = {
  id: string
  label: string
  thinkingLevels?: ThinkingLevel[]
  defaultThinkingLevel?: string
}

export type CommitMessageAgentCapability = {
  id: TuiAgent
  label: string
  modelSource: 'static' | 'dynamic'
  models: CommitMessageModelCapability[]
  defaultModelId: string
}

export const COMMIT_MESSAGE_MODEL_JSON_STRUCTURE_LIMITS = {
  structuralTokens: 64 * 1024,
  nestingDepth: 16
} as const

const BASIC_THINKING_LEVELS: ThinkingLevel[] = [
  { id: 'low', label: 'Low' },
  { id: 'medium', label: 'Medium' },
  { id: 'high', label: 'High' }
]

const OPENAI_THINKING_LEVELS: ThinkingLevel[] = [
  { id: 'low', label: 'Low' },
  { id: 'medium', label: 'Medium' },
  { id: 'high', label: 'High' },
  { id: 'xhigh', label: 'Extra High' }
]

const CLAUDE_THINKING_LEVELS: ThinkingLevel[] = [
  { id: 'low', label: 'Low' },
  { id: 'medium', label: 'Medium' },
  { id: 'high', label: 'High' },
  { id: 'xhigh', label: 'Extra High' },
  { id: 'max', label: 'Max' }
]

function labelFromModelId(id: string): string {
  return id
    .split(/[/-]/)
    .filter(Boolean)
    .map((part) => {
      if (/^gpt$/i.test(part)) {
        return 'GPT'
      }
      return part.length <= 3 && /^\d/.test(part)
        ? part.toUpperCase()
        : part.charAt(0).toUpperCase() + part.slice(1)
    })
    .join(' ')
}

function uniqueModels(models: CommitMessageModel[]): CommitMessageModel[] {
  const seen = new Set<string>()
  return models.filter((model) => {
    if (!model.id || seen.has(model.id)) {
      return false
    }
    seen.add(model.id)
    return true
  })
}

function* iterateModelOutputLines(output: string): Generator<string> {
  let lineStart = 0

  for (let index = 0; index < output.length; index++) {
    const code = output.charCodeAt(index)
    if (code !== 10 && code !== 13) {
      continue
    }

    yield output.slice(lineStart, index)
    if (code === 13 && output.charCodeAt(index + 1) === 10) {
      index++
    }
    lineStart = index + 1
  }

  if (lineStart <= output.length) {
    yield output.slice(lineStart)
  }
}

function withOpenAiThinking(
  id: string
): Pick<CommitMessageModel, 'thinkingLevels' | 'defaultThinkingLevel'> {
  return /(?:gpt-5|codex)/i.test(id)
    ? { thinkingLevels: OPENAI_THINKING_LEVELS, defaultThinkingLevel: 'low' }
    : {}
}

export function parseCodexModels(stdout: string): CommitMessageModel[] {
  try {
    assertJsonTextStructureWithinLimits(stdout, COMMIT_MESSAGE_MODEL_JSON_STRUCTURE_LIMITS)
    const parsed = JSON.parse(stdout) as {
      models?: {
        slug?: string
        display_name?: string
        supported_reasoning_levels?: { effort?: string }[]
        default_reasoning_level?: string
      }[]
    }
    return uniqueModels(
      (parsed.models ?? [])
        .filter((model) => model.slug && model.display_name)
        .map((model) => ({
          id: model.slug!,
          label: model.display_name!,
          ...(model.supported_reasoning_levels?.length
            ? {
                thinkingLevels: model.supported_reasoning_levels
                  .map((level) => level.effort)
                  .filter((effort): effort is string => Boolean(effort))
                  .map((effort) => ({
                    id: effort,
                    label: effort === 'xhigh' ? 'Extra High' : labelFromModelId(effort)
                  })),
                defaultThinkingLevel: model.default_reasoning_level ?? 'low'
              }
            : {})
        }))
    )
  } catch {
    return []
  }
}

export function parseLineModels(stdout: string): CommitMessageModel[] {
  const models: CommitMessageModel[] = []
  for (const rawLine of iterateModelOutputLines(stdout)) {
    const id = rawLine.trim()
    if (id.length === 0 || id.includes(' ')) {
      continue
    }
    models.push({
      id,
      label: labelFromModelId(id),
      ...withOpenAiThinking(id)
    })
  }
  return uniqueModels(models)
}

export function parsePiModels(stdout: string): CommitMessageModel[] {
  const models: CommitMessageModel[] = []
  for (const rawLine of iterateModelOutputLines(stdout)) {
    const parts = getPiModelTableFields(rawLine, 6)
    if (parts.length < 6 || parts[0] === 'provider') {
      continue
    }

    const [provider, model, , , thinking] = parts
    const id = `${provider}/${model}`
    models.push({
      id,
      label: `${labelFromModelId(provider)} ${labelFromModelId(model)}`,
      ...(thinking === 'yes'
        ? {
            thinkingLevels: [
              { id: 'off', label: 'Off' },
              { id: 'low', label: 'Low' },
              { id: 'medium', label: 'Medium' },
              { id: 'high', label: 'High' },
              { id: 'xhigh', label: 'Extra High' }
            ],
            defaultThinkingLevel: 'low'
          }
        : {})
    })
  }
  return uniqueModels(models)
}

// Why: model discovery output can include paste-sized noisy lines; only the first fields matter.
function getPiModelTableFields(line: string, maxFields: number): string[] {
  const fields: string[] = []
  let tokenStart = -1

  for (let index = 0; index <= line.length; index += 1) {
    const isEnd = index === line.length
    if (!isEnd && !isPiModelTableWhitespace(line.charCodeAt(index))) {
      if (tokenStart === -1) {
        tokenStart = index
      }
      continue
    }
    if (tokenStart !== -1) {
      fields.push(line.slice(tokenStart, index))
      tokenStart = -1
      if (fields.length >= maxFields) {
        break
      }
    }
  }

  return fields
}

function isPiModelTableWhitespace(code: number): boolean {
  return (
    code === 32 ||
    (code >= 9 && code <= 13) ||
    code === 160 ||
    code === 5760 ||
    (code >= 8192 && code <= 8202) ||
    code === 8232 ||
    code === 8233 ||
    code === 8239 ||
    code === 8287 ||
    code === 12288 ||
    code === 65279
  )
}

export function parseCursorModels(stdout: string): CommitMessageModel[] {
  const models: CommitMessageModel[] = []
  for (const rawLine of iterateModelOutputLines(stdout)) {
    const match = /^([^\s]+)\s+-\s+(.+)$/.exec(rawLine.trim())
    if (!match) {
      continue
    }
    models.push({
      id: match[1],
      label: match[2].replace(/\s+\((?:default|current)\)$/i, ''),
      ...withOpenAiThinking(match[1])
    })
  }
  return uniqueModels(models)
}

export function parseAntigravityModels(stdout: string): CommitMessageModel[] {
  const models: CommitMessageModel[] = []
  for (const rawLine of iterateModelOutputLines(stdout)) {
    const id = rawLine.trim()
    if (id.length === 0) {
      continue
    }
    models.push({
      id,
      label: id
    })
  }
  return uniqueModels(models)
}
