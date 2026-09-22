const {test, expect, _electron: electron} = require("@playwright/test");
const {launchElectronApp, closeElectronApp} = require("./helpers/electronApp");

test("built Electron app survives losing its stdout and stderr readers", async () => {
    const app = await launchElectronApp(electron, {isolatedUserDataDir: true, env: {
        FDO_E2E_LIVE_AI: "0", OPENAI_API_KEY: undefined,
        ANTHROPIC_API_KEY: undefined, FDO_TEST_AI_API_KEY: undefined,
    }});
    try {
        const page = await app.firstWindow();
        // Exercise the bundled startup handler before creating asynchronous
        // errors. If tree shaking removes it, evaluate rejects cleanly instead
        // of opening Electron's uncaught-exception dialog on the developer's PC.
        await app.evaluate(() => {
            for (const stream of [process.stdout, process.stderr]) {
                stream.emit("error", Object.assign(new Error("closed output pipe"), {code: "EPIPE"}));
            }
        });
        app.process().stdout.destroy();
        app.process().stderr.destroy();
        const state = await app.evaluate(async ({app, BrowserWindow}) => {
            process.stdout.write("closed stdout probe\n");
            process.stderr.write("closed stderr probe\n");
            console.error("console.error after losing the output reader");
            const window = new BrowserWindow({show: false});
            await window.loadURL("data:text/html,<p>Local IPC probe</p>");
            const frame = window.webContents.mainFrame;
            window.destroy();
            // This is the native error-reporting path from the reported stack.
            try { frame.send("local-probe", {}); } catch (_) {}
            await new Promise(resolve => setTimeout(resolve, 100));
            return {ready: app.isReady(), windows: BrowserWindow.getAllWindows().length};
        });
        expect(state.ready).toBe(true);
        expect(state.windows).toBeGreaterThan(0);
        await expect(page.locator("body")).toBeVisible();
    } finally {
        // Playwright reads debugger-shutdown acknowledgements from stderr,
        // which this fault-injection test deliberately disconnected.
        const child = app.process();
        const forceExit = setTimeout(() => child.kill("SIGKILL"), 3000);
        try { await closeElectronApp(app); }
        finally { clearTimeout(forceExit); }
    }
});
