# Plugin UI lifecycle

A mounted plugin view retains its document, frontend handlers, widgets and temporary settings during background rendering, runtime status polling, and switching between enabled plugins. The host does not save temporary form values or frontend state to disk.

Identical render payloads are ignored. When a background request returns different HTML or `renderOnLoad()` code, the host keeps the existing view running and offers **Open updated view** or **Keep current view**. Opening the update intentionally disposes the old frontend view, runs its cleanup, and initializes the new view. Keeping the current view suppresses repeated offers of the same payload. A later different payload can be offered again.

## Quick actions and sidebar actions

Return a boolean `refreshUi` from a registered backend handler invoked through the host quick bar or sidebar:

```ts
// A data operation retains the current frontend and its temporary settings.
async copyResult() {
  await this.copyCurrentResult();
  return {success: true, refreshUi: false};
}

// An intentional navigation replaces the current view without another prompt.
async openHistory() {
  this.currentView = 'history';
  return {success: true, refreshUi: true};
}
```

The host reads the flag from the handler result, including a transport envelope's `result`. A boolean on the action registration is also supported as a default; a returned boolean takes precedence. Use handler results when the installed SDK's registration types do not include this host extension.

Existing handlers without the flag still run and request a render. Identical content remains untouched; changed content is offered to the user. For immediate navigation, update those handlers to return `refreshUi: true`. Do not return it for background jobs, copy actions, data refreshes, or operations whose frontend should retain its state.

In-iframe `window.createBackendReq` calls retain their existing behavior. Their frontend handlers should update the current DOM or widget controller after receiving data. Keep `render()` and `renderOnLoad()` deterministic unless intentionally changing views.

## Recovery and diagnostics

Before any UI is posted, startup recovery is bounded: at most two greeting retries and two layout retries. Once a render payload is posted, missing readiness or mount signals show an actionable error and require explicit reload, even if the initial mount acknowledgement is delayed. A slow or failed view update cannot trigger an automatic frame replacement that discards another view's temporary state.

Each iframe document has a stable identifier. Duplicate greetings are ignored, and queued stages from a retired document cannot affect the replacement document. Genuine unexpected document navigation produces a notification because the browser has already discarded the old document. Permission changes, deployments, and GitOps updates can require a frame restart; their existing notifications and lifecycle diagnostics explain that transition.

Host lifecycle events appear in plugin log tails and traces as `ui.*` events with a reason and attempt number. The host writes `host-ui.jsonl` under the plugin's data `logs` directory, rotating at 256 KiB and retaining one previous file. Logging is rate limited and contains no HTML, form values, handler results, or credentials. A disk logging failure does not interrupt the UI; the bounded in-memory trace remains available.

For host integrations and lifecycle tests, `window.electron.plugin.render(id)` requests a non-destructive update; `render(id, {replace: true})` explicitly requests a full view replacement. This privileged desktop bridge is not available inside plugin frames.
