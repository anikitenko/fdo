const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

let e2eUserDataDir = "";

function ensureE2EUserDataDir() {
  if (e2eUserDataDir) {
    return e2eUserDataDir;
  }
  const workerIndex = process.env.TEST_WORKER_INDEX || "0";
  const prefix = `fdo-e2e-${process.pid}-${workerIndex}-`;
  e2eUserDataDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return e2eUserDataDir;
}

async function dismissBlueprintOverlays(page, { timeout = 1000 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const anyOverlay = await page.$('.bp6-dialog, .bp6-alert, .bp6-overlay-open');
    if (!anyOverlay) break;

    const primary = page.locator('.bp6-dialog .bp6-button.bp6-intent-primary, .bp6-alert .bp6-button.bp6-intent-primary');
    if (await primary.count()) {
      await primary.first().click({ trial: false }).catch(() => {});
      await page.waitForTimeout(50);
      continue;
    }

    const labels = ['OK', 'Confirm', 'Switch', 'Close', 'Dismiss'];
    let clicked = false;
    for (const label of labels) {
      const btn = page.locator(`.bp6-dialog button:has-text("${label}"), .bp6-alert button:has-text("${label}")`).first();
      if (await btn.count()) {
        await btn.click().catch(() => {});
        clicked = true;
        await page.waitForTimeout(50);
        break;
      }
    }

    if (!clicked) {
      await page.keyboard.press('Escape').catch(() => {});
      await page.waitForTimeout(50);
    }
  }
}

async function launchElectronApp(electron) {
  const userDataDir = ensureE2EUserDataDir();
  let app = null;
  let lastError = null;
  const maxLaunchAttempts = Number(process.env.FDO_E2E_LAUNCH_RETRIES || 3);
  for (let attempt = 1; attempt <= maxLaunchAttempts; attempt += 1) {
    try {
      app = await electron.launch({
        args: ['.'],
        env: {
          ...process.env,
          FDO_E2E: '1',
          FDO_E2E_MULTI_INSTANCE: '1',
          FDO_E2E_USER_DATA_DIR: userDataDir,
        },
      });
      break;
    } catch (error) {
      lastError = error;
      if (attempt >= maxLaunchAttempts) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
    }
  }
  if (!app) {
    throw lastError || new Error("Electron app launch failed");
  }
  const firstWindow = await app.firstWindow();
  try {
    await firstWindow.evaluate(() => {
      window.__E2E__ = true;
    });
  } catch (_) {}
  const acceptAllDialogs = async (dialog) => {
    try {
      await dialog.accept();
    } catch (_) {}
  };

  firstWindow.on('dialog', acceptAllDialogs);
  app.on('window', (page) => {
    page.on('dialog', acceptAllDialogs);
    page.evaluate(() => {
      window.__E2E__ = true;
    }).catch(() => {});
  });

  await firstWindow.waitForLoadState('domcontentloaded', { timeout: 30000 });
  await installToastObserver(firstWindow);
  app.on('window', (page) => {
    installToastObserver(page).catch(() => {});
  });
  return app;
}

async function installToastObserver(page) {
  await page.evaluate(() => {
    window.__e2eToastLog = window.__e2eToastLog || [];
    if (window.__e2eToastObserverInstalled) {
      return;
    }

    const recordToast = (node) => {
      if (!(node instanceof HTMLElement)) return;
      const text = node.innerText?.trim();
      if (!text) return;
      window.__e2eToastLog.push({
        text,
        className: node.className || "",
        ts: Date.now(),
      });
    };

    document.querySelectorAll?.('.bp6-toast').forEach(recordToast);

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        mutation.addedNodes.forEach((node) => {
          if (!(node instanceof HTMLElement)) return;
          if (node.matches?.('.bp6-toast')) {
            recordToast(node);
          }
          node.querySelectorAll?.('.bp6-toast').forEach(recordToast);
        });
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    window.__e2eToastObserverInstalled = true;
  });
}

async function installConfirmObserver(page) {
  await page.evaluate(() => {
    if (window.__e2eConfirmObserverInstalled) {
      return;
    }
    window.__e2eConfirmLog = [];
    const originalConfirm = typeof window.confirm === 'function' ? window.confirm.bind(window) : (() => true);
    window.confirm = (message) => {
      window.__e2eConfirmLog.push({
        message: String(message || ''),
        ts: Date.now(),
      });
      return true;
    };
    window.__e2eOriginalConfirm = originalConfirm;
    window.__e2eConfirmObserverInstalled = true;
  });
}

async function clearToastLog(page) {
  await page.evaluate(() => {
    window.__e2eToastLog = [];
  });
}

async function clearConfirmLog(page) {
  await page.evaluate(() => {
    window.__e2eConfirmLog = [];
  });
}

async function closeElectronApp(app) {
  if (!app) return;
  try {
    const windows = app.windows();
    for (const win of windows) {
      try {
        await win.evaluate(() => {
          try { window.onbeforeunload = null; } catch (_) {}
          try { window.alert = () => {}; } catch (_) {}
          try { window.confirm = () => true; } catch (_) {}
          try { window.prompt = () => ''; } catch (_) {}
        });
      } catch (_) {}
      try {
        await win.close({ runBeforeUnload: false });
      } catch (_) {}
    }
  } catch (_) {}

  try {
    await app.close();
  } catch (_) {}

  if (e2eUserDataDir && process.env.FDO_E2E_KEEP_USER_DATA !== "1") {
    try {
      fs.rmSync(e2eUserDataDir, { recursive: true, force: true });
    } catch (_) {}
    e2eUserDataDir = "";
  }
}

async function openEditorWithMockedIPC(app, overrides = {}) {
  const window = await app.firstWindow();
  await window.waitForLoadState('domcontentloaded');
  const useRealAssistants = !!overrides?.__useRealAssistants;
  const fixtureId = `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const pluginDisplayName = String(overrides?.pluginDisplayName || `E2E Plugin ${fixtureId}`);
  const pluginDir = String(overrides?.pluginDir || `/tmp/${fixtureId}`);
  const pluginTemplate = String(overrides?.pluginTemplate || "basic");
  const sandboxName = `sandbox_${pluginDisplayName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-+)|(-+$)/g, '')}`;

  await window.evaluate(({ extra, pluginDisplayName, pluginDir, sandboxName, useRealAssistants }) => {
    window.__E2E__ = true;
    window.__SNAPSHOTS_ENABLED = true;
    window.electron = window.electron || {};
    window.electron.system = window.electron.system || {};
    try {
      window.localStorage.removeItem(sandboxName);
    } catch (_) {}
    window.electron.system.getModuleFiles = () => Promise.resolve({ files: [] });
    window.electron.system.getFdoSdkTypes = () => Promise.resolve({ files: [] });
    window.electron.settings = window.electron.settings || {};
    window.electron.settings.certificates = window.electron.settings.certificates || {};
    window.electron.settings.certificates.getRoot = async () => [];
    window.electron.settings.ai = window.electron.settings.ai || {};
    if (!useRealAssistants) {
      window.electron.settings.ai.getAssistants = async () => ([
        {
          id: "e2e-coding-assistant",
          name: "E2E Coding Assistant",
          provider: "openai",
          model: "gpt-4.1-mini",
          purpose: "coding",
          default: true,
          apiKey: "e2e",
        },
      ]);
    }

    if (extra && typeof extra === 'object') {
      Object.assign(window, extra.window || {});
    }
  }, { extra: overrides, pluginDisplayName, pluginDir, sandboxName, useRealAssistants });
  await clearToastLog(window);

  const pluginData = encodeURIComponent(JSON.stringify({
    name: pluginDisplayName,
    template: pluginTemplate,
    dir: pluginDir,
  }));

  await window.evaluate((pd) => {
    window.location.hash = `#/editor?data=${pd}`;
  }, pluginData);
  await window.waitForFunction(() => location.hash.startsWith('#/editor'));
  await installConfirmObserver(window);
  await clearConfirmLog(window);
  return window;
}

async function getToastLog(page) {
  return await page.evaluate(() => window.__e2eToastLog || []);
}

async function getConfirmLog(page) {
  return await page.evaluate(() => window.__e2eConfirmLog || []);
}

async function expectNoToastContaining(page, pattern) {
  const raw = await getToastLog(page);
  const rx = pattern instanceof RegExp ? pattern : new RegExp(String(pattern), 'i');
  const match = raw.find((entry) => rx.test(entry?.text || ""));
  if (match) {
    throw new Error(`Unexpected toast matched ${rx}: ${match.text}`);
  }
}

async function expectNoUnexpectedErrorToasts(page, options = {}) {
  const {
    allow = [],
  } = options;
  const raw = await getToastLog(page);
  const allowList = allow.map((entry) => (
    entry instanceof RegExp ? entry : new RegExp(String(entry), 'i')
  ));
  const suspect = raw.filter((entry) => {
    const text = entry?.text || "";
    if (!text) return false;
    const className = entry?.className || "";
    const looksDanger = /intent-danger|bp6-toast-message/i.test(className) || /(error|failed|exception|denied|not found)/i.test(text);
    if (!looksDanger) return false;
    return !allowList.some((rx) => rx.test(text));
  });
  if (suspect.length) {
    throw new Error(`Unexpected error toasts: ${suspect.map((entry) => entry.text).join(" | ")}`);
  }
}

module.exports = {
  dismissBlueprintOverlays,
  launchElectronApp,
  closeElectronApp,
  openEditorWithMockedIPC,
  clearToastLog,
  clearConfirmLog,
  getToastLog,
  getConfirmLog,
  expectNoToastContaining,
  expectNoUnexpectedErrorToasts,
  installConfirmObserver,
};
