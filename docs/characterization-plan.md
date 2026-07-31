# Characterization plan

Phase 1 freezes retained Orca behavior before removal or runtime migration. The Host/runtime/daemon is authoritative; renderer and mobile stores are projections. A timeout, disconnect, or skipped native environment is never recorded as success.

## Replacement strategy

- Runtime and process state: headless runtime RPC plus the control CLI, with authoritative read-back, operation IDs, generations, and JSON envelopes.
- Renderer-visible state: Vitest component/state contracts against the same runtime clients.
- PTY, Git, filesystem, SSH, relay: Docker integration fixtures with failure and concurrency injection.
- WebView2, ConPTY, WSL2/systemd, native IME/WebGL/pointer: native smoke jobs with explicit environment status and inspected, deleted screenshots.
- Removed products: absence audits for route, RPC, schema, dependency, asset, documentation, and runtime reachability.

`config/characterization/area-contracts.json` defines the retained-area invariants. `config/characterization/playwright-intent-rules.json` classifies every Playwright-selected spec by replacement layer. The audit also inventories Playwright imports outside the suite so tool and benchmark dependencies cannot disappear silently.

## Missing control surfaces to implement

1. Folder workspace list/add/inspect/remove with host-qualified identity.
2. Terminal resize/inspect plus authoritative exit reason, incarnation, history bounds, and reattach disposition.
3. Session snapshot/flush with revision and host generation.
4. File watch event stream with heartbeat and pairing/host generation.
5. Git workflow and SSH connection/forward inspection commands using existing runtime RPC services.

These commands must use the same headless service logic as later GUI/Web/mobile adapters, support `--json`, isolate concurrent fixtures, and expose failure state rather than adding fallback behavior.

Run the catalog gate with a caller-unique project identity so concurrent agents cannot recreate or stop each other's container:

```sh
ADE_CHARACTERIZATION_RUN_ID=<unique-run-id> docker compose -f compose.characterization.yml up --build --abort-on-container-exit --exit-code-from characterization-plan characterization-plan
```
