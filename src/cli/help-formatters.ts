import type { CommandSpec } from './args'
import { findCommandSpec, isCommandGroup } from './args'
import { unknownCommandData } from './command-suggestion'

import { ROOT_HELP_TEXT } from './help-root-text'

export function printHelp(specs: CommandSpec[], commandPath: string[] = []): void {
  const exactSpec = findCommandSpec(specs, commandPath)
  if (exactSpec) {
    console.log(formatCommandHelp(exactSpec))
    return
  }

  if (isCommandGroup(commandPath)) {
    console.log(formatGroupHelp(specs, commandPath[0]))
    return
  }

  if (commandPath.length > 0) {
    const { nextSteps } = unknownCommandData(specs, commandPath)
    const recovery = nextSteps.map((step) => `Next step: ${step}`).join('\n')
    console.log(`Unknown command: ${commandPath.join(' ')}${recovery ? `\n${recovery}` : ''}\n`)
  }

  console.log(ROOT_HELP_TEXT)
}

export function formatCommandHelp(spec: CommandSpec): string {
  const lines = [`orca ${spec.path.join(' ')}`, '', `Usage: ${spec.usage}`, '', spec.summary]
  const displayedFlags = spec.argumentMode === 'passthrough' ? [] : spec.allowedFlags

  if (displayedFlags.length > 0) {
    lines.push('', 'Options:')
    for (const flag of displayedFlags) {
      lines.push(`  ${formatCommandFlagHelp(flag, spec.path)}`)
    }
  }

  if (spec.notes && spec.notes.length > 0) {
    lines.push('', 'Notes:')
    for (const note of spec.notes) {
      lines.push(`  ${note}`)
    }
  }

  if (spec.examples && spec.examples.length > 0) {
    lines.push('', 'Examples:')
    for (const example of spec.examples) {
      lines.push(`  $ ${example}`)
    }
  }

  return lines.join('\n')
}

export function formatGroupHelp(specs: CommandSpec[], group: string): string {
  const groupSpecs = specs.filter((spec) => spec.path[0] === group)
  const lines = [`orca ${group}`, '', `Usage: orca ${group} <command> [options]`, '', 'Commands:']
  for (const spec of groupSpecs) {
    lines.push(`  ${spec.path.slice(1).join(' ').padEnd(18)} ${spec.summary}`)
  }
  lines.push('', `Run \`orca ${group} <command> --help\` for command-specific usage.`)
  return lines.join('\n')
}

function formatCommandFlagHelp(flag: string, commandPath: string[]): string {
  const command = commandPath.join(' ')
  if (command === 'terminal close' && flag === 'tab') {
    return '--tab                  Close the whole tab and wait for durable persistence'
  }
  if (command === 'linear issue' && flag === 'id') {
    return '--id <id>             Linear issue key, id, or URL'
  }
  if (command === 'linear issue' && flag === 'workspace') {
    return '--workspace <id>      Connected Linear workspace id'
  }
  if (command === 'linear search' && flag === 'query') {
    return '--query <text>        Text to search across Linear issues'
  }
  if (command === 'linear search' && flag === 'workspace') {
    return '--workspace <id|all>  Connected Linear workspace id, or all'
  }
  if (command === 'linear list-issues' && flag === 'cursor') {
    return '--cursor <cursor>      Opaque cursor returned by a previous list-issues page'
  }
  if (command === 'linear list-issues' && flag === 'workspace') {
    return '--workspace <id|all>  Connected Linear workspace id, or all'
  }
  if (command.startsWith('linear ') && flag === 'workspace') {
    return '--workspace <id>      Connected Linear workspace id'
  }
  if (command.startsWith('linear ') && flag === 'body') {
    return '--body <text>         Linear comment or issue body'
  }
  if (command.startsWith('linear ') && flag === 'body-file') {
    return '--body-file <path|->  Read Linear body from a file or stdin'
  }
  if (command.startsWith('linear ') && flag === 'write-id') {
    return '--write-id <uuid>     Retry id from linear_write_unconfirmed'
  }
  if (command.startsWith('linear ') && flag === 'to') {
    return '--to <state>          Exact Linear workflow state name'
  }
  if (command === 'linear comment add' && flag === 'reply-to') {
    return '--reply-to <id>       Comment id to reply to'
  }
  if (command === 'linear attach' && flag === 'url') {
    return '--url <url>           Absolute http(s) link to attach'
  }
  if (command === 'linear attach' && flag === 'title') {
    return '--title <text>        Attachment title'
  }
  if (command === 'linear create' && flag === 'title') {
    return '--title <text>        New Linear issue title'
  }
  if (command === 'linear create' && flag === 'team') {
    return '--team <key>          Linear team key'
  }
  if (command === 'linear create' && flag === 'parent') {
    return '--parent <id>         Parent Linear issue key, id, or URL'
  }
  if (command === 'linear create' && flag === 'parent-current') {
    return '--parent-current      Use the current linked issue as parent'
  }
  if (command === 'worktree create' && flag === 'parent-worktree') {
    return '--parent-worktree <selector> Parent selector such as active/current, id:<repo-id>::<path>, branch:<branch>, issue:<number>, path:<path>, folder:<id>, or worktree:<worktreeId>'
  }
  // Why: the shared --agent help describes launching a TUI agent in a terminal,
  // which is the wrong meaning here — this selects the account provider.
  if (command === 'account add' && flag === 'agent') {
    return '--agent <id>           Account provider: claude or codex (default claude)'
  }
  return formatFlagHelp(flag)
}

export function formatFlagHelp(flag: string): string {
  const helpByFlag: Record<string, string> = {
    agent: '--agent <id>          Launch a known TUI agent in the first terminal',
    'base-branch': '--base-branch <ref>    Base branch/ref to create the worktree from',
    command: '--command <text>       Command to run in the terminal on startup',
    comment: '--comment <text>       Comment stored in Orca metadata',
    cursor: '--cursor <n>           Line cursor from a previous read (returns only new output)',
    action: '--action <name>       Secondary accessibility action name',
    activate: '--activate             Reveal the new worktree in the Orca app',
    direction:
      '--direction <dir>      Direction: up|down|left|right for scroll, horizontal|vertical for split',
    'display-name': '--display-name <name>  Override the Orca display name',
    title: '--title <text>         Custom title for the terminal tab (omit to reset)',
    enter: '--enter                Append Enter after sending text',
    force: '--force                Force worktree removal when supported',
    focus: '--focus                Reveal the created terminal session in Orca',
    for: '--for exit|tui-idle    Wait condition to satisfy',
    'from-x': '--from-x <x>           Source window-local x coordinate',
    'from-y': '--from-y <y>           Source window-local y coordinate',
    help: '--help                 Show this help message',
    interrupt: '--interrupt            Send as an interrupt-style input when supported',
    id: '--id <id>             Identifier for a target item or permission',
    issue: '--issue <number|null>  Linked GitHub issue number',
    'linear-issue':
      '--linear-issue <id|url|null> Linked Linear issue identifier or URL; null clears on set',
    json: '--json                 Emit machine-readable JSON',
    key: '--key <key>            Key argument for this command',
    limit: '--limit <n>            Maximum number of rows to return',
    local: '--local                Target the current project instead of the global install',
    mode: '--mode <mode>          Mode such as edit, diff, or both',
    name: '--name <name>          Name for the new worktree',
    'no-parent': '--no-parent            Force no parent lineage for unrelated work',
    pages: '--pages <n>           Number of scroll pages',
    'parent-worktree':
      '--parent-worktree <selector> Parent worktree selector such as id:<repo-id>::<path>, branch:<branch>, issue:<number>, path:<path>, or active/current',
    path: '--path <path>          Path argument for the command',
    prompt: '--prompt <text>        Prompt text for agent-backed commands',
    query: '--query <text>        Search text for matching refs',
    ref: '--ref <ref>            Base ref to persist for the repo',
    repo: '--repo <selector>      Repo selector such as id:<id>, name:<name>, or path:<path>',
    setup: '--setup run|skip|inherit Setup policy for repo-defined setup hooks',
    terminal: '--terminal <handle>  Runtime-issued terminal handle',
    text: '--text <text>          Text payload to send or type',
    'text-stdin': '--text-stdin          Read text payload from stdin',
    'timeout-ms': '--timeout-ms <ms>     Maximum wait time before timing out',
    'to-x': '--to-x <x>             Destination window-local x coordinate',
    'to-y': '--to-y <y>             Destination window-local y coordinate',
    worktree:
      '--worktree <selector>  Worktree selector such as id:<repo-id>::<path>, name:<displayName>, branch:<branch>, issue:<number>, path:<path>, or active/current',
    'workspace-status':
      '--workspace-status <id> Board status id (defaults: todo, in-progress, in-review, completed)',
    staged: '--staged               Open staged source-control changes',
    provider: '--provider <agent>     Agent id such as codex, claude, or gemini',
    'value-stdin': '--value-stdin         Read set-value payload from stdin',
  }

  if (flag === 'current') {
    return '--current              Use the current Orca worktree linked Linear issue'
  }
  if (flag === 'comments') {
    return '--comments             Include threaded Linear comments'
  }
  if (flag === 'children') {
    return '--children             Include recursive child issues'
  }
  if (flag === 'depth') {
    return '--depth <n>            Child issue depth for --children/--full'
  }
  if (flag === 'attachments') {
    return '--attachments          Include attachment metadata and URLs'
  }
  if (flag === 'relations') {
    return '--relations            Include blocking, related, and duplicate links'
  }
  if (flag === 'activity') {
    return '--activity             Include issue field-change history'
  }
  if (flag === 'full') {
    return '--full                 Include all supported V1 issue context within caps'
  }

  return helpByFlag[flag] ?? `--${flag}`
}
