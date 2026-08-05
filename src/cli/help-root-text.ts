export const ROOT_HELP_TEXT = `orca

Usage: orca <command> [options]

Startup:
  open                      Launch Orca and wait for the runtime to be reachable
  serve                     Start a headless Orca runtime server
  status                    Show app/runtime/graph readiness

Diagnostics:
  diagnostics memory        Collect a memory snapshot for Orca and managed terminals

Agent Discovery:
  agent-context             Print the machine-readable command schema for agents

Accounts:

Environments:
  environment add           Save a remote Orca runtime from a pairing code
  environment list          List saved remote Orca runtimes
  environment show          Show one saved remote Orca runtime
  environment rm            Remove a saved remote Orca runtime

Projects:
  project list              List durable projects known to Orca
  project setups            List project host setups
  project setup-existing-folder Make a project available on a host by importing an existing folder
  project setup-clone       Make a project available on a host by cloning a repository
  project setup-create      Create independent project host setup metadata
  project setup-update      Update project host setup metadata
  project setup-delete      Remove a project host setup

Repos:
  repo list                 List repos registered in Orca
  repo add                  Add a project to Orca by filesystem path
  repo show                 Show one registered repo
  repo set-base-ref         Set the repo's default base ref for future worktrees
  repo search-refs          Search branch/tag refs within a repo

Worktrees:
  worktree list             List Orca-managed worktrees
  worktree show             Show one worktree
  worktree current          Show the Orca-managed worktree for the current directory
  worktree create           Create a new Orca-managed worktree
  worktree set              Update Orca metadata for a worktree
  worktree rm               Remove a worktree from Orca and git
  worktree ps               Show a compact orchestration summary across worktrees

Files:
  file open                 Open a workspace file in the Orca editor
  file diff                 Open a workspace file diff in the Orca editor
  file open-changed         Open all git-changed files for a workspace

Terminals:
  terminal list             List live Orca-managed terminals
  terminal show             Show terminal metadata and preview
  terminal inspect          Inspect authoritative terminal lifecycle and history state
  terminal resize           Resize a terminal with authoritative provider readback
  terminal read             Read bounded terminal output
  terminal send             Send input to a live terminal
  terminal wait             Wait for a terminal condition (exit, tui-idle)
  terminal stop             Stop terminals for a worktree
  terminal create           Create a terminal session in a worktree
  terminal rename           Set or clear the title of a terminal tab
  terminal split            Split an existing terminal pane
  terminal switch           Bring a terminal tab to the foreground
  terminal focus            Alias for terminal switch
  terminal close            Close a terminal pane/session, or its whole tab with --tab

Linear:
  linear                    Read Linear ticket context for agents

Common Commands:
  orca open [--json]
  orca serve [--port <port>] [--pairing-address <host>] [--mobile-pairing] [--no-pairing] [--project-root <path>] [--recipe-json] [--json]
  orca status [--json]
  orca diagnostics memory [--json]
  orca agent-context [--json]
  orca environment add --name <name> --pairing-code <code> [--json]
  orca environment list [--json]
  orca environment show --environment <selector> [--json]
  orca environment rm --environment <selector> [--json]
  orca worktree list [--repo <selector>] [--limit <n>] [--json]
  orca worktree create --name <name> [--repo <selector>|--project <id> [--host <host-id>]|--project-host-setup <id>] [--agent <id>] [--prompt <text>] [--setup run|skip|inherit] [--base-branch <ref>] [--issue <number>] [--linear-issue <identifier-or-url>] [--comment <text>] [--parent-worktree <selector>] [--no-parent] [--run-hooks] [--activate] [--json]
  orca worktree show --worktree <selector> [--json]
  orca worktree current [--json]
  orca worktree set --worktree <selector> [--display-name <name>] [--issue <number|null>] [--linear-issue <identifier-or-url|null>] [--comment <text>] [--workspace-status <id>] [--parent-worktree <selector>|--no-parent] [--json]
  orca worktree rm --worktree <selector> [--force] [--run-hooks] [--json]
  orca worktree ps [--limit 10] [--json]
  orca file open <path> [--worktree <selector>] [--json]
  orca file diff <path> [--staged] [--worktree <selector>] [--json]
  orca file open-changed [--mode edit|diff|both] [--worktree <selector>] [--json]
  orca terminal list [--worktree <selector>] [--limit <n>] [--json]
  orca terminal show --terminal <handle> [--json]
  orca terminal read --terminal <handle> [--cursor <n>] [--limit <n>] [--json]
  orca terminal send --terminal <handle> [--text <text>] [--enter] [--interrupt] [--json]
  orca terminal wait --terminal <handle> --for exit|tui-idle [--timeout-ms <ms>] [--json]
  orca terminal stop --worktree <selector> [--json]
  orca terminal create [--worktree <selector>] [--title <name>] [--command <text>] [--focus] [--json]
  orca terminal split --terminal <handle> [--direction horizontal|vertical] [--json]
  orca terminal switch --terminal <handle> [--json]
  orca terminal close --terminal <handle> [--tab] [--json]

Selectors:
  --repo <selector>         Registered repo selector such as id:<id>, name:<name>, or path:<path>
  --worktree <selector>     Worktree selector such as id:<repo-id>::<path>, name:<displayName>, branch:<branch>, issue:<number>, path:<path>, or active/current
  --terminal <handle>       Runtime-issued terminal handle returned by \`orca terminal list --json\`
  --parent-worktree <selector> Parent worktree selector such as id:<repo-id>::<path>, branch:<branch>, issue:<number>, path:<path>, or active/current
  --no-parent               Force no parent lineage for unrelated worktree creation/update

Terminal Send Options:
  --text <text>             Text to send to the terminal
  --enter                   Append Enter after sending text
  --interrupt               Send as an interrupt-style input when supported

Wait Options:
  --for exit                Wait until the target terminal exits
  --timeout-ms <ms>         Maximum wait time before timing out

Output Options:
  --json                    Emit machine-readable JSON instead of human text
  --pairing-code <code>      Connect to a remote Orca runtime using an orca://pair?... code
  --environment <selector>   Connect using a saved environment id or name
  --help                    Show this help message

Behavior:
  Most commands require a running Orca runtime. If Orca is not open yet, run \`orca open\` first.
  Remote runtime access can also be supplied with ORCA_PAIRING_CODE or ORCA_ENVIRONMENT.
  Use selectors for discovery and handles for repeated live terminal operations.

Agent Sessions And Worktrees:
  \`worktree create --agent\` creates a new checkout with an agent.
  To start a fresh agent in the current worktree, use:
    orca terminal create --worktree active --command "codex"

Examples:
  $ orca open
  $ orca status --json
  $ orca diagnostics memory --json
  $ orca repo list
  $ orca worktree create --name agent-task --agent codex --prompt "hi"
  $ orca worktree current
  $ orca worktree ps --limit 10
  $ orca file open-changed --mode diff
  $ orca terminal create --worktree active --command "codex"
  $ orca terminal send --terminal term_123 --text "hi" --enter
  $ orca terminal wait --terminal term_123 --for exit --timeout-ms 60000 --json`
