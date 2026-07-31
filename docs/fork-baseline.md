# Fork baseline

- Upstream: `https://github.com/stablyai/orca.git`
- Baseline commit: `79251d7a9861568dc261faabfa16df5347d1d008`
- Baseline parent: `886fa7b4389fd309aee6a8674554f542be3b0eea`
- Commit date: `2026-07-31T06:08:26-07:00`
- Package version: `1.4.163-rc.1`
- License: MIT, Copyright (c) 2026 Lovecast Inc.

The baseline commit is preserved without amendment. ADE changes begin in its descendants.

## Reproduction environment

Baseline checks use Node 24 and pnpm 10.24.0 in Linux containers. The Windows desktop compile/package result must be recorded separately on a Windows runner because a Linux result is not evidence for WebView2 or Windows packaging.

Every Compose invocation requires a caller-unique `ADE_BASELINE_RUN_ID`. This isolates the immutable baseline volume when agents run checks concurrently. A partial source volume fails with exit 70; retry with a new run ID rather than reusing incomplete state. Commands in the result JSON are historical observations, not reusable run IDs. Machine-readable results and strict status semantics live in `docs/fork-baseline-results.json`; each observed Linux result links a hashed Docker observation artifact.

## Recorded baseline

Results below describe the unmodified upstream tree at the baseline commit. A non-zero exit is a recorded baseline result, never interpreted as success.

| Surface | Command | Result |
| --- | --- | --- |
| Provenance and license | `ADE_BASELINE_RUN_ID=<unique-run-id> docker compose up --build --abort-on-container-exit --exit-code-from baseline-tests baseline-tests` | Pass: 7 tests |
| Core Vitest | `ADE_BASELINE_RUN_ID=<unique-run-id> docker compose up --build --abort-on-container-exit --exit-code-from baseline-core-tests baseline-core-tests` | Exit 1: 4 files/6 tests failed; 3,993 files/42,243 tests passed; 14 files/178 tests skipped |
| Web build | `ADE_BASELINE_RUN_ID=<unique-run-id> docker compose up --build --abort-on-container-exit --exit-code-from baseline-web-build baseline-web-build` | Pass with existing CSS/chunk-size warnings |
| Mobile typecheck | `ADE_BASELINE_RUN_ID=<unique-run-id> docker compose up --build --abort-on-container-exit --exit-code-from baseline-mobile-typecheck baseline-mobile-typecheck` | Pass |
| Mobile tests | `ADE_BASELINE_RUN_ID=<unique-run-id> docker compose up --build --abort-on-container-exit --exit-code-from baseline-mobile-tests baseline-mobile-tests` | Pass: 376 files, 2,794 tests; 3 skipped |
| Windows desktop | `pnpm build:win` on a Windows runner | Not run: no Windows runner is attached to this workspace |

The core run used read-only Git metadata plus OpenSSL and `procps`, which its integration tests require. The remaining failures were:

- `config-sync-stall.test.ts`, `hook-service.test.ts`, three `history-manager.test.ts` cases, and `titlebar-extension-service.test.ts`: baseline failures retained without modification.

The Windows result is explicitly unobserved; Linux compilation is not used as a substitute for Windows desktop evidence.

Known failures are retained with their exact exit status and error signature. They are not repaired on the baseline commit.
