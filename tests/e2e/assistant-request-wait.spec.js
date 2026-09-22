const {test, expect, _electron: electron} = require('@playwright/test');
const {launchElectronApp, closeElectronApp} = require('./helpers/electronApp');
const {waitForAssistantUiToSettle} = require('./helpers/assistantRequestWait.cjs');

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
