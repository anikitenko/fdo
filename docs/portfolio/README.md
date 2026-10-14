# FDO architecture portfolio

Three English portfolio images, designed at 1600 × 1000 pixels. These are architecture diagrams based on the repository, not screenshots of a successfully generated Workbench and not a claim of a security audit.

- `01-plugin-boundaries.png` — host authority, plugin execution contexts and explicit capabilities.
- `02-reversible-workspace.png` — staged generation, validation and restore points.
- `03-provider-adapters.png` — provider-specific integrations behind an application contract.

Open [the editable slide deck](fdo-architecture.html) in a browser. Each section is a separate image; the stylesheet also supports printing the deck. Text, colors and diagrams are ordinary HTML/CSS, with no external fonts or assets.

Suggested project description:

> FDO is a modular desktop platform for developer and DevOps tools. I designed its plugin boundaries, workspace editor and AI integration layer around explicit contracts, reversible changes and observable request handling. The architecture separates plugin execution from the host UI, validates generated workspace files before application, and adapts native provider protocols behind shared application workflows.

Use only the parts that accurately describe your personal contribution. This draft describes repository decisions; it does not establish sole authorship, commercial adoption, measured performance or production reliability.

## Evidence behind each slide

| Slide | Implementation references | Limits worth explaining in an interview |
| --- | --- | --- |
| Plugin boundaries | [main.js](../../src/main.js), [PluginManager.js](../../src/utils/plugins/runtime/PluginManager.js), [pluginRuntimeSecurity.js](../../src/utils/plugins/security/pluginRuntimeSecurity.js), [PluginContainer.jsx](../../src/components/PluginContainer.jsx), [PluginPage.jsx](../../src/components/plugin/PluginPage.jsx), [preload.js](../../src/preload.js) | Utility-process isolation is not an OS sandbox. Runtime policy, capabilities and UI isolation are separate layers. |
| Reversible workspace | [codingWorkspaceGeneration.js](../../src/utils/ai/generation/codingWorkspaceGeneration.js), [AiCodingAgentPanel.jsx](../../src/components/editor/AiCodingAgentPanel.jsx), [VirtualFS.js](../../src/components/editor/utils/VirtualFS.js), [generatedWorkspaceImports.js](../../src/utils/plugins/validation/generatedWorkspaceImports.js) | Source acceptance does not replace compilation, type checking or runtime tests. Snapshots provide recovery; the slide does not assert a database-level atomic disk commit. |
| Provider adapters | [aiProviderClient.js](../../src/utils/ai/providers/aiProviderClient.js), [adapters](../../src/utils/ai/providers), [usage ledger](../../src/utils/ai/billing/ledger.js), [pricing](../../src/utils/ai/billing/pricing.js) | Provider/model feature support varies. Gateway adapters use compatible APIs. Model quality and availability remain external dependencies; token counts and monetary estimates are distinct. |

The diagrams intentionally contain no API keys, account identifiers, request logs or generated customer code.
