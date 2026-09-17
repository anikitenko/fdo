## SDK DX Rollout Note

This rollout aligns FDO host wiring to SDK-owned contracts for Monaco/editor support, Plugin Doctor panel rendering, renderOnLoad template authoring, fixture runtime matrix CI, and handshake compatibility gating.

### Risk Summary

- Primary risk is SDK contract drift between installed SDK and host expectations (editor policy fields, handshake payload shape, matrix contract version, or template ids).
- Host behavior now prefers SDK policy/model helpers first and keeps conservative fallbacks only when helpers are unavailable.
- Existing plugin runtime execution paths are unchanged; this rollout focuses on host orchestration, diagnostics, and editor DX wiring.

### Fallback Paths

- Monaco/editor:
  - If SDK editor policy helper is unavailable, host falls back to `hasSdkIndex`-driven defaults.
  - Namespace-only `FDOOnLoad` fallback typings remain available when SDK index types are missing.
- Plugin Doctor:
  - If SDK doctor helpers are unavailable, host keeps legacy raw diagnostics mode.
- renderOnLoad templates:
  - Picker is SDK-driven; if template helpers are unavailable, picker resolves to empty and editor remains functional.
- Handshake:
  - If diagnostics do not include handshake, host marks legacy/degraded mode and continues with conservative defaults.

### Blocked Release Conditions

- Unsupported SDK fixture matrix contract version.
- Any fixture runtime matrix lifecycle/probe failure in CI.
- Handshake/API/contract major mismatch (`incompatible` status).
- Missing required SDK contract fields or template IDs used by host UX paths.

### Required Upgrade Sequence

1. Run migration first: `fdo sdk migrate --target <plugins>` (and `--write` if applying).
2. Land SDK version bump and host wiring updates in the same PR.
3. Require matrix CI + handshake compatibility checks to pass before release.
4. Publish release notes with migration guidance for any UX-visible contract changes.
