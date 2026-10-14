const {test, expect, _electron: electron} = require('@playwright/test');
const {launchElectronApp, closeElectronApp} = require('./helpers/electronApp');
const {waitForAssistantUiToSettle, createLiveAiTimeoutMonitor} = require('./helpers/assistantRequestWait.cjs');

test('validated progress extends both the real Playwright deadline and assistant wait', async ({}, testInfo) => {
  const startedAt = Date.now();
  const app = await launchElectronApp(electron, {isolatedUserDataDir: true});
  try {
    const windowPromise = app.waitForEvent('window');
    await app.evaluate(({BrowserWindow}) => {
      const window = new BrowserWindow({show: false});
      window.loadURL('about:blank');
    });
    const page = await windowPromise;
    await page.setContent('<button>Stop</button>');
    const initialTimeout = Date.now() - startedAt + 800;
    testInfo.setTimeout(initialTimeout);
    await page.evaluate(() => setTimeout(() => document.querySelector('button').remove(), 1200));
    await waitForAssistantUiToSettle(page, 800, {remainingMs: createLiveAiTimeoutMonitor({
      testInfo, initialTimeout, startedAt,
      // Use a short earned duration to exercise the actual runner timer.
      readBudget: async () => ({timeoutExtensionMs: 3000, validatedFiles: 1}),
    })});
    expect(testInfo.timeout).toBe(initialTimeout + 3000);
  } finally { await closeElectronApp(app); }
});

test('assistant wait handles partial replies, fast results, errors, deadlines and closed pages', async () => {
  const app = await launchElectronApp(electron, {isolatedUserDataDir: true});
  try {
    // Use a separate renderer to exercise real Playwright polling independently
    // of provider credentials and app navigation.
    const windowPromise = app.waitForEvent('window');
    await app.evaluate(({BrowserWindow}) => {
      const window = new BrowserWindow({show: false});
      window.loadURL('about:blank');
    });
    const page = await windowPromise;
    await page.setContent('<button>Stop</button><div data-testid="ai-coding-response">Partial answer</div>');
    let finished = false;
    const pending = waitForAssistantUiToSettle(page, 5000).then(() => { finished = true; });
    await page.waitForTimeout(400);
    expect(finished, 'A partial answer must not end the wait while Stop is present').toBe(false);
    await page.evaluate(() => document.querySelector('button').remove());
    await pending;

    for (const testId of ['ai-coding-response', 'ai-coding-error']) {
      await page.setContent(`<div data-testid="${testId}">Already finished</div>`);
      await waitForAssistantUiToSettle(page, 2000);
    }
    await page.setContent('<div data-testid="ai-coding-response">Previous answer</div>');
    await page.evaluate(() => { window.__liveAiResponses = [{success: true}]; });
    let repairFinished = false;
    const repair = waitForAssistantUiToSettle(page, 5000, {afterResponseCount: 1})
      .then(() => { repairFinished = true; });
    await page.waitForTimeout(400);
    expect(repairFinished, 'A stale answer must not finish the next repair').toBe(false);
    await page.evaluate(() => document.body.insertAdjacentHTML('beforeend', '<button>Stop</button>'));
    await page.waitForTimeout(400);
    await page.evaluate(() => document.querySelector('button').remove());
    await page.waitForTimeout(400);
    expect(repairFinished, 'The repair must produce a new terminal response').toBe(false);
    await page.evaluate(() => { window.__liveAiResponses.push({success: true}); });
    await repair;
    // Completion may happen before the polling code ever sees Stop.
    await waitForAssistantUiToSettle(page, 1000, {afterResponseCount: 1});
    await page.setContent('<button>Stop</button>');
    await expect(waitForAssistantUiToSettle(page, 400)).rejects.toThrow(/Timeout|deadline/i);
    await page.setContent('<p>No request has started</p>');
    await expect(waitForAssistantUiToSettle(page, 400)).rejects.toThrow(/Timeout/i);

    await page.setContent('<button>Stop</button>');
    const closed = expect(waitForAssistantUiToSettle(page, 5000)).rejects.toThrow(/closed/i);
    await page.close();
    await closed;
  } finally { await closeElectronApp(app); }
});

test('cleanup terminates its Electron process when the automation close path is lost', async () => {
  const app = await launchElectronApp(electron, {isolatedUserDataDir: true});
  const child = app.process();
  try {
    // Model the observed failure: no Playwright pages, but Electron is alive.
    await closeElectronApp({windows: () => [], process: () => child,
      close: async () => { throw new Error('Browser connection closed'); }});
    expect(child.exitCode !== null || child.signalCode !== null).toBe(true);
  } finally { await closeElectronApp(app); }
});

test('live GUI power guard uses the native API and releases its assertion', async () => {
  const {acquireElectronPowerGuard} = require('./helpers/electronPowerGuard.cjs');
  const app = await launchElectronApp(electron, {isolatedUserDataDir: true});
  try {
    const guard = await acquireElectronPowerGuard(app);
    expect(await app.evaluate(({powerSaveBlocker}, id) => powerSaveBlocker.isStarted(id), guard.id)).toBe(true);
    await guard.release();
    expect(await app.evaluate(({powerSaveBlocker}, id) => powerSaveBlocker.isStarted(id), guard.id)).toBe(false);
  } finally { await closeElectronApp(app); }
});

test('live test driver explicitly approves the guide through its UI', async () => {
  const app = await launchElectronApp(electron, {isolatedUserDataDir: true});
  try {
    const windowPromise = app.waitForEvent('window');
    await app.evaluate(({BrowserWindow}) => { const win = new BrowserWindow({show: false}); win.loadURL('about:blank'); });
    const page = await windowPromise;
    await page.setContent('<button id="stop">Stop</button><button data-testid="approve-plugin-guide">Approve and continue</button>');
    await page.evaluate(() => {
      window.approvals = 0;
      document.querySelector('[data-testid="approve-plugin-guide"]').onclick = () => {
        window.approvals++;
        document.getElementById('stop').remove();
      };
    });
    await waitForAssistantUiToSettle(page, 5000, {approvePluginGuide: true});
    expect(await page.evaluate(() => window.approvals)).toBe(1);
  } finally { await closeElectronApp(app); }
});

test('plugin selection waits for Home inventory after its API becomes available', async () => {
  const {selectPluginOpen} = require('./helpers/sdkExamples');
  const app = await launchElectronApp(electron, {isolatedUserDataDir: true});
  try {
    const windowPromise = app.waitForEvent('window');
    await app.evaluate(({BrowserWindow}) => {
      const window = new BrowserWindow({show: false});
      window.loadURL('about:blank');
    });
    const page = await windowPromise;
    await page.evaluate(() => {
      window.selectionAttempts = 0;
      window.inventoryReady = false;
      window.__homeTestApi = {selectPluginById(id, options) {
        window.selectionAttempts++;
        if (!window.inventoryReady) return false;
        window.selectedPlugin = {id, options};
        return true;
      }};
      setTimeout(() => {window.inventoryReady = true;}, 500);
    });
    await selectPluginOpen(page, 'generated-workbench');
    expect(await page.evaluate(() => window.selectedPlugin)).toEqual({id: 'generated-workbench', options: {open: true}});
    expect(await page.evaluate(() => window.selectionAttempts)).toBeGreaterThan(1);
  } finally { await closeElectronApp(app); }
});
