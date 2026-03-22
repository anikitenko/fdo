# Codex Safe Bundling Checklist

Use this checklist for Phase 12 verification.

## What is implemented

- Codex runtime resolution is centralized
- configured path, bundled runtime, and `PATH` fallback all use the same resolver
- bundled Codex is blocked unless its version is at or above the minimum safe version
- runtime source/version are persisted on the coding assistant entry
- packaged-build wiring mirrors the existing `esbuild` pattern:
  - `@openai/codex` is copied into `dist/main/node_modules`
  - bundled resources are copied into `app.asar.unpacked`

## Manual checks

1. Add a `Codex CLI (ChatGPT)` coding assistant in Settings.
2. If using an external install:
   - leave executable path empty, or
   - provide a specific executable path
3. Expected in assistant card:
   - `Executable: ...`
   - `Runtime: configured|path|bundled (version)`

## Bundled runtime security gate

1. Package or stage a bundled Codex runtime below the minimum safe version.
2. Try adding or using the Codex assistant.
3. Expected:
   - assistant verification fails
   - error explicitly says bundled Codex is blocked below the minimum safe version

4. Package or stage a bundled Codex runtime at or above the safe version.
5. Try adding or using the Codex assistant.
6. Expected:
   - verification succeeds
   - runtime source shows `bundled`

## Coding-agent execution

1. Select the Codex assistant in AI Coding Agent.
2. Run a simple request like `Explain Code`.
3. Expected:
   - it resolves through the same safe runtime path
   - streaming works normally

## Packaged build checks

Run this once per target:
- `DMG`
- `RPM`
- `DEB`

For each target:
1. launch the packaged app
2. add or inspect the Codex assistant
3. verify runtime source
4. run a simple coding-agent request
5. verify failure mode if bundled runtime is unsafe or auth is missing
