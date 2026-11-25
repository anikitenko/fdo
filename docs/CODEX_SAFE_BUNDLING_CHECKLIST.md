# Codex distribution verification

FDO 1.0.7 uses a separately installed native Codex CLI. See [local setup](AI_CODING_AGENT.md#connect-local-codex-cli).

For every release target, inspect ASAR and unpacked resources against `third_party/distribution-policy.json`. Verify that the package inventory excludes Codex and its platform packages. Run the packaged local setup test with a missing CLI and an external installation. Review each target's evidence in the licensing ledger before publishing.
