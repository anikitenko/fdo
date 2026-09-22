const {EventEmitter} = require("node:events");
const {observeLiveAiPage, describeLiveAiWaitFailure, readLiveAiMainProcess} = require("../e2e/helpers/liveAiLifecycle.cjs");

test('test timeout takes precedence over teardown page closure', () => {
  expect(describeLiveAiWaitFailure(true, {windows: [{destroyed: false, webContentsDestroyed: false}]}, true))
    .toContain('live-test time limit');
  expect(describeLiveAiWaitFailure(true, {readError: 'Object destroyed'}, true)).toContain('live-test time limit');
});

test('window destruction preserves coding lifecycle and other window diagnostics', () => {
  globalThis.__FDO_E2E_CODING_LIFECYCLE__ = [{event: 'request-started', workspaceStep: '/styles.css'}];
  try {
    const result = readLiveAiMainProcess({app: {isReady: () => true}, BrowserWindow: {getAllWindows: () => [
      {id: 1, isDestroyed: () => true, get webContents() { throw new Error('Must not access'); }},
      {id: 2, isDestroyed: () => false, isVisible: () => true, get webContents() { throw new Error('Object has been destroyed'); }},
      {id: 3, isDestroyed: () => false, isVisible: () => true, webContents: {isDestroyed: () => true, getURL: () => { throw new Error('Must not access'); }}},
      {id: 4, isDestroyed: () => false, isVisible: () => true, webContents: {isDestroyed: () => false, id: 4, getURL: () => 'file:///editor.html'}},
    ]}});
    expect(result.codingLifecycle).toEqual(globalThis.__FDO_E2E_CODING_LIFECYCLE__);
    expect(result.windows).toEqual([
      {id: 1, destroyed: true}, {id: 2, destroyed: false, visible: true, readError: 'Object has been destroyed'},
      {id: 3, destroyed: false, visible: true, webContentsDestroyed: true},
      {id: 4, destroyed: false, visible: true, webContentsDestroyed: false, webContentsId: 4, url: 'file:///editor.html'},
    ]);
    expect(describeLiveAiWaitFailure(true, {windows: [result.windows[1]]})).toContain('Editor page closed');
  } finally { delete globalThis.__FDO_E2E_CODING_LIFECYCLE__; }
});

test("distinguishes a lost Playwright page from a destroyed Electron window", () => {
  expect(describeLiveAiWaitFailure(true, {windows: [{destroyed: false, webContentsDestroyed: false}]}))
    .toContain("Playwright lost the editor page");
  expect(describeLiveAiWaitFailure(true, {windows: []})).toContain("Editor page closed");
  expect(describeLiveAiWaitFailure(true, {readError: "Disconnected"})).toContain("Editor page closed");
  expect(describeLiveAiWaitFailure(false, {})).toContain("deadline");
});

test("records inspector and transport loss and removes connection listeners", async () => {
  const page = new EventEmitter();
  const context = new EventEmitter();
  const browser = new EventEmitter();
  const session = new EventEmitter();
  session.send = jest.fn().mockResolvedValue({});
  session.detach = jest.fn().mockResolvedValue(undefined);
  context.browser = () => browser;
  context.newCDPSession = jest.fn().mockResolvedValue(session);
  const record = jest.fn();
  const dispose = await observeLiveAiPage({context: () => context}, page, record);
  session.emit("Inspector.detached", {reason: "replaced_with_devtools"});
  browser.emit("disconnected");
  context.emit("close");
  page.emit("close");
  expect(record.mock.calls).toEqual([
    ["inspector-detached", {reason: "replaced_with_devtools"}],
    ["playwright-browser-disconnected"],
    ["playwright-context-close"],
    ["editor-page-close"],
  ]);
  await dispose();
  expect(browser.listenerCount("disconnected")).toBe(0);
  expect(context.listenerCount("close")).toBe(0);
  expect(session.detach).toHaveBeenCalledTimes(1);
});

test("unavailable inspector diagnostics do not prevent the scenario from running", async () => {
  const context = new EventEmitter();
  context.browser = () => null;
  context.newCDPSession = jest.fn().mockRejectedValue(new Error("Target closed"));
  const record = jest.fn();
  const dispose = await observeLiveAiPage({context: () => context}, new EventEmitter(), record);
  expect(record).toHaveBeenCalledWith("inspector-observer-unavailable", {message: "Target closed"});
  await dispose();
});
