export function resolveTauriRustBuildCommand(env, platform) {
  const runner = env.ADE_TAURI_CARGO_RUNNER
  if (runner === undefined) return platform === 'win32' ? 'cargo.exe' : 'cargo'
  if (runner !== 'cargo-xwin') throw new Error('invalid_tauri_cargo_runner')
  return runner
}
