// Observe the automation connection without attaching Electron's debugger,
// which would compete with Playwright for control of the renderer.
async function observeLiveAiPage(app, page, record) {
  page.on("close", () => record("editor-page-close"));
  page.on("crash", () => record("editor-page-crash"));
  const context = app.context();
  const onContextClose = () => record("playwright-context-close");
  const onDisconnected = () => record("playwright-browser-disconnected");
  context.on("close", onContextClose);
  const browser = context.browser();
  browser?.on("disconnected", onDisconnected);
  let session;
  try {
    session = await context.newCDPSession(page);
    session.on("Inspector.detached", ({reason}) => record("inspector-detached", {reason}));
    session.on("Inspector.targetCrashed", () => record("inspector-target-crashed"));
    await session.send("Inspector.enable");
  } catch (error) {
    record("inspector-observer-unavailable", {message: String(error.message || error)});
  }
  return async () => {
    context.off("close", onContextClose);
    browser?.off("disconnected", onDisconnected);
    await session?.detach().catch(() => {});
  };
}

// Self-contained: Playwright serializes this function into Electron's main
// process. A single window disappearing must not discard request diagnostics.
function readLiveAiMainProcess({app, BrowserWindow}) {
  return {
    ready: app.isReady(),
    runtime: {electron: process.versions.electron, chromium: process.versions.chrome, node: process.versions.node},
    lifecycle: globalThis.__FDO_E2E_WINDOW_LIFECYCLE__ || [],
    codingLifecycle: globalThis.__FDO_E2E_CODING_LIFECYCLE__ || [],
    requestBudget: globalThis.__FDO_E2E_LIVE_AI_BUDGET__ || null,
    windows: BrowserWindow.getAllWindows().map(window => {
      const state = {};
      try {
        state.id = window.id;
        state.destroyed = window.isDestroyed();
        if (state.destroyed) return state;
        state.visible = window.isVisible();
        const contents = window.webContents;
        state.webContentsDestroyed = contents.isDestroyed();
        if (!state.webContentsDestroyed) {
          state.webContentsId = contents.id;
          state.url = contents.getURL();
        }
      } catch (error) { state.readError = String(error.message || error); }
      return state;
    }),
  };
}

function describeLiveAiWaitFailure(pageClosed, mainProcess, timedOut = false) {
  if (timedOut) return "The live-test time limit was reached before the assistant finished. Page closure during teardown is not evidence of a transport failure.";
  if (!pageClosed) return "Assistant request did not settle before the live-test deadline.";
  const rendererAlive = mainProcess?.windows?.some(window => window.destroyed === false && window.webContentsDestroyed === false && !window.readError);
  return rendererAlive
    ? "Playwright lost the editor page while Electron still reported a live window. Inspect the transport lifecycle for the disconnect cause."
    : "Editor page closed before the assistant request settled.";
}

module.exports = {observeLiveAiPage, describeLiveAiWaitFailure, readLiveAiMainProcess};
