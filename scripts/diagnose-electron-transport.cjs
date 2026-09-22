// A local reproduction of a long Coding Agent stream. No provider is called,
// no plugin is generated, and the Electron profile is temporary.
const fs = require("node:fs");
const path = require("node:path");
const {runLivePlaywright} = require("./lib/run-live-playwright.cjs");

async function bounded(promise, milliseconds = 5000) {
    let timer;
    try {
        return await Promise.race([promise, new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error("Diagnostic operation timed out")), milliseconds);
        })]);
    } finally { clearTimeout(timer); }
}

async function probe(durationMs, waitMs, artifactDir, contentMode) {
    const {_electron, expect} = require("@playwright/test");
    const {launchElectronApp, openEditorWithMockedIPC, closeElectronApp} = require("../tests/e2e/helpers/electronApp");
    const {observeLiveAiPage} = require("../tests/e2e/helpers/liveAiLifecycle.cjs");
    const {waitForAssistantUiToSettle} = require("../tests/e2e/helpers/assistantRequestWait.cjs");
    const report = {runner: process.version, playwright: require("@playwright/test/package.json").version, durationMs, waitMs, contentMode, events: [], status: "running", passed: false};
    fs.mkdirSync(artifactDir, {recursive: true});
    fs.writeFileSync(path.join(artifactDir, "transport-probe.json"), JSON.stringify(report, null, 2));
    const record = (event, details = {}) => report.events.push({event, at: new Date().toISOString(), ...details});
    let app;
    let disposeObserver;
    let progress;
    try {
        app = await launchElectronApp(_electron, {isolatedUserDataDir: true, keepDisplayAwake: true, env: {
            FDO_E2E_LIVE_AI: "0", FDO_E2E_KEEP_USER_DATA: "0",
            OPENAI_API_KEY: undefined, ANTHROPIC_API_KEY: undefined, FDO_TEST_AI_API_KEY: undefined,
        }});
        app.process().on("exit", (exitCode, signal) => record("electron-process-exit", {exitCode, signal}));
        const initial = await app.firstWindow();
        initial.setDefaultTimeout(15000);
        await initial.waitForFunction(async () => {
            try { await window.electron.settings.ai.getAssistants(); return true; } catch { return false; }
        });
        report.runtime = await app.evaluate(() => ({electron: process.versions.electron, chromium: process.versions.chrome, node: process.versions.node}));
        report.preventDisplaySleep = true;
        await app.evaluate(({ipcMain}, {durationMs, waitMs, contentMode}) => {
            ipcMain.removeHandler("settings:ai_assistants:get");
            ipcMain.handle("settings:ai_assistants:get", () => [{id: "local-probe", name: "Local transport probe", provider: "openai", model: "simulated", purpose: "coding", default: true}]);
            for (const action of ["generate-code", "smart-mode", "edit-code", "fix-code", "plan-code"]) {
                ipcMain.removeHandler(`ai-coding-agent:${action}`);
                ipcMain.handle(`ai-coding-agent:${action}`, (event, {requestId}) => new Promise(resolve => {
                    const state = globalThis.__transportProbe = {chunks: 0, heartbeats: 0, reset: false, completed: false};
                    const started = Date.now();
                    let lastHeartbeat = started;
                    const timer = setInterval(() => {
                        const elapsed = Date.now() - started;
                        if (elapsed < waitMs) {
                            if (Date.now() - lastHeartbeat >= 10000) {
                                lastHeartbeat = Date.now();
                                state.heartbeats++;
                                event.sender.send("ai-coding-agent:on_off:stream-delta", {requestId, type: "heartbeat", content: " "});
                            }
                            return;
                        }
                        let freshFile = state.chunks === 0;
                        if (!state.reset && elapsed >= waitMs + (durationMs - waitMs) / 2) {
                            state.reset = true;
                            event.sender.send("ai-coding-agent:on_off:stream-delta", {requestId, type: "reset"});
                            freshFile = true;
                        }
                        state.chunks++;
                        const content = contentMode === 'code'
                            ? `${freshFile ? '### File: /styles/workbench.css\n```css\n' : ''}.tile-${state.chunks} { display: grid; gap: 16px; color: #d9a56c; padding: 24px; }\n`
                            : "Local diagnostic stream: checking editor responsiveness.\n";
                        event.sender.send("ai-coding-agent:on_off:stream-delta", {requestId, type: "content", content});
                    }, 100);
                    setTimeout(() => {
                        clearInterval(timer);
                        const content = "Local transport diagnostic complete.";
                        event.sender.send("ai-coding-agent:on_off:stream-done", {requestId, fullContent: content});
                        state.completed = true;
                        resolve({success: true, requestId, content});
                    }, durationMs);
                }));
            }
            ipcMain.removeHandler("ai-coding-agent:route-judge");
            ipcMain.handle("ai-coding-agent:route-judge", () => ({success: false, error: "Local diagnostic uses Generate directly"}));
        }, {durationMs, waitMs, contentMode});
        const page = await openEditorWithMockedIPC(app, {__useRealAssistants: true});
        page.setDefaultTimeout(15000);
        disposeObserver = await observeLiveAiPage(app, page, record);
        await page.getByRole("tab", {name: "AI Coding Agent", exact: true}).click();
        await page.locator("#action-select").selectOption("generate");
        await page.getByLabel("Changes", {exact: true}).selectOption("review");
        await page.locator("#prompt-input").fill("Check local editor streaming responsiveness.");
        await page.locator("#prompt-input").press(process.platform === "darwin" ? "Meta+Enter" : "Control+Enter");
        const stop = page.getByRole("button", {name: "Stop", exact: true});
        await expect(stop).toBeVisible();
        const started = Date.now();
        progress = setInterval(() => console.log(`Waiting for diagnostic completion: ${Math.round((Date.now() - started) / 1000)}s`), 30000);
        // Exercise the same renderer-side wait as every live provider scenario.
        await waitForAssistantUiToSettle(page, durationMs + 15000);
        Object.assign(report, await bounded(app.evaluate(() => globalThis.__transportProbe)));
        if (!report.completed || !report.chunks || !report.reset) throw new Error("Simulated stream did not finish and reset successfully");
        if (waitMs > 11000 && !report.heartbeats) throw new Error("No heartbeat was delivered during the initial wait");
        record("stream-completed");
        report.passed = true;
    } catch (error) {
        report.error = String(error.message || error);
        report.mainProcess = await bounded(app?.evaluate(({BrowserWindow}) => ({
            windows: BrowserWindow.getAllWindows().map(w => ({id: w.id, destroyed: w.isDestroyed(), webContentsDestroyed: w.webContents.isDestroyed()})),
        }))).catch(error => ({readError: String(error.message || error)}));
        process.exitCode = 1;
    } finally {
        clearInterval(progress);
        record("cleanup-started");
        await bounded(Promise.resolve().then(() => disposeObserver?.())).catch(() => {});
        if (app) {
            // A broken inspector connection must not hang diagnostic cleanup.
            const child = app.process();
            const terminate = setTimeout(() => child.kill("SIGTERM"), 5000);
            const kill = setTimeout(() => child.kill("SIGKILL"), 10000);
            try { await bounded(closeElectronApp(app), 12000); }
            catch { child.kill("SIGKILL"); }
            finally { clearTimeout(terminate); clearTimeout(kill); }
        }
        report.status = report.passed ? "passed" : "failed";
        fs.writeFileSync(path.join(artifactDir, "transport-probe.json"), JSON.stringify(report, null, 2));
        console.log(`Local transport diagnostic: ${report.passed ? "passed" : "failed"}`);
    }
}

async function main() {
    const durationMs = Number(process.env.FDO_TRANSPORT_PROBE_DURATION_MS || 240000);
    if (!Number.isInteger(durationMs) || durationMs < 5000 || durationMs > 600000) throw new Error("FDO_TRANSPORT_PROBE_DURATION_MS must be 5000..600000");
    const waitMs = Number(process.env.FDO_TRANSPORT_PROBE_WAIT_MS || 0);
    if (!Number.isInteger(waitMs) || waitMs < 0 || waitMs > durationMs - 1000) throw new Error("FDO_TRANSPORT_PROBE_WAIT_MS must leave at least 1000ms for streaming");
    const artifactDir = path.resolve(process.env.FDO_TRANSPORT_PROBE_ARTIFACT_DIR || "artifacts/transport-probe");
    const contentMode = process.env.FDO_TRANSPORT_PROBE_CONTENT || 'code';
    if (!['code', 'text'].includes(contentMode)) throw new Error('FDO_TRANSPORT_PROBE_CONTENT must be code or text');
    if (process.argv.includes("--worker")) return probe(durationMs, waitMs, artifactDir, contentMode);
    const result = await runLivePlaywright([__filename, "--worker"], {
        artifactDir,
        env: {...process.env, FDO_E2E_KEEP_USER_DATA: "0", FDO_E2E_LIVE_AI_PROTOCOL_DIAGNOSTICS: "1"},
    });
    process.exitCode = result.signal ? 1 : (result.status ?? 1);
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
