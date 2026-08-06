# AGENTS.md — E2E Tests

## Prefer a Store-Slice Unit Test When the Logic Is Pure

An E2E spec that calls `store.getState().someAction(...)` inside `page.evaluate` is a unit test paying the cost of an Electron launch (~1.5s) for no extra coverage. Before adding one, check `src/renderer/src/store/slices/*.test.ts` — most store-level behavior (tab moves, splits, reorders, merges, no-op guards) is already covered there with `createTestAppStore()`.

Reach for E2E only when the test needs something a unit test genuinely cannot reach:

- Real dnd-kit / pointer events, focus, keyboard shortcuts, or drag-and-drop UI cues.
- IPC round-trips through the main process (repos, filesystem, PTY, Git).
- Persistence: app restart, userData dir, session rehydration.
- Multi-window or multi-worktree interactions that depend on Electron lifecycle.

If the test could be rewritten to import the slice and drive it directly without losing fidelity, do that instead.

## E2E Assertions Must Target the DOM, Not the Store

`window.__store` is fine for _setup_ (seeding a repo, pre-filling a draft, stubbing hydration timing) but the thing a spec finally `expect()`s on must be user-observable — `getByRole`, `toBeVisible`, `toHaveText`, `toContainText`. A spec that both writes to the store and reads it back is asserting that Zustand's setter works, not that Orca works.

Why this matters: the `'create-worktree'` modal key lived on in the `activeModal` union long after `AddWorktreeDialog.tsx` was deleted in #710, so `store.openModal('create-worktree')` + `store.activeModal === 'create-worktree'` round-trips succeeded against a modal that rendered nothing. That tautology is what let #1186 (React error #31 in `StartFromField`) ship — the store-layer test passed while the composer actively crashed for real users.

Concretely:

- Use the store to reach a state; use the DOM to prove the state is correct.
- If a render-layer regression would leave the store clean but the UI broken, a store-only test will not catch it. Mount the affected subtree and assert on what the user sees.
- Headless runs do not exempt you from this rule: assertions still target the
  rendered DOM regardless of window visibility. Use a visible window only when
  the scenario genuinely needs focus or pointer capture.
