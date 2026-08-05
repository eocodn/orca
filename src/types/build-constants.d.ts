// Ambient declarations for compile-time constants substituted by the build
// configs. Official release builds provide a stable/rc channel identity;
// contributor and hourly builds substitute `null`.
declare const ORCA_BUILD_IDENTITY: 'stable' | 'rc' | null

// Diagnostic-bundle upload endpoint for Mode 3 (telemetry-error-tracking.md
// §Endpoint contract). Substituted by CI; `null` in contributor builds, at
// which point the upload IPC handler returns "endpoint not configured"
// rather than POSTing to a placeholder. The dev escape hatch is the
// `ORCA_DIAGNOSTICS_TOKEN_URL` env var, which env wins so a developer can
// point a packaged build at a staging server without re-running the
// release pipeline.
declare const ORCA_DIAGNOSTICS_TOKEN_URL: string | null
