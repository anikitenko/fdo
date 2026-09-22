const {test, expect, _electron: electron} = require("@playwright/test");
const {launchElectronApp, closeElectronApp} = require("./helpers/electronApp");
const {runWorkbenchOperation, checkWorkbenchPersonalSpace} = require("./live-ai-scenarios/web-tools-workbench.cjs");

test("workbench checks select operations independently of defaults and hidden workspaces", async () => {
  const app = await launchElectronApp(electron, {isolatedUserDataDir: true});
  try {
    const newWindow = app.waitForEvent("window");
    await app.evaluate(async ({BrowserWindow}) => {
      const window = new BrowserWindow({show: false});
      await window.loadURL("about:blank");
    });
    const page = await newWindow;
    // Deliberately start with title case and URL decoding, and keep a hidden
    // workspace in the DOM. The shared live-test driver must select and scope
    // the operation instead of relying on whichever option happens to be first.
    await page.setContent(`
      <section data-category="text">
        <label>Transformation <select>
          <option value="title">Title case</option>
          <option value="lower">lowercase</option>
          <option value="upper">UPPERCASE</option>
        </select></label>
        <textarea data-role="tool-category-input"></textarea>
        <button data-role="tool-category-action">Run</button>
        <pre data-role="tool-category-result" data-state="idle"></pre>
      </section>
      <section data-category="data" hidden>
        <label>Operation <select>
          <option value="decode">Decode URL text</option>
          <option value="encode">Encode URL text</option>
          <option value="json">Format JSON</option>
        </select></label>
        <textarea data-role="tool-category-input"></textarea>
        <button data-role="tool-category-action">Run</button>
        <pre data-role="tool-category-result" data-state="idle"></pre>
      </section>`);
    await page.evaluate(() => {
      for (const workspace of document.querySelectorAll("section")) {
        const select = workspace.querySelector("select");
        // Reading state from change events also checks that selection uses a
        // real browser interaction, rather than silently assigning DOM values.
        let mode = select.value;
        select.addEventListener("change", () => { mode = select.value; });
        workspace.querySelector("button").addEventListener("click", () => {
          const value = workspace.querySelector("textarea").value;
          const output = workspace.querySelector("pre");
          const operations = {
            upper: () => value.toUpperCase(), lower: () => value.toLowerCase(),
            title: () => value.toLowerCase().replace(/\b\w/g, letter => letter.toUpperCase()),
            json: () => JSON.stringify(JSON.parse(value), null, 2),
            encode: () => encodeURIComponent(value), decode: () => decodeURIComponent(value),
          };
          output.textContent = operations[mode]();
          output.dataset.state = "success";
        });
      }
    });
    const text = page.locator('[data-category="text"]');
    for (const [mode, expectedText] of [
      ["upper", "HELLO LOCAL TOOLS"], ["lower", "hello local tools"], ["title", "Hello Local Tools"],
    ]) {
      await runWorkbenchOperation(text, {mode, value: "hELLO LOCAL tools", expectedText}, expect);
    }
    await page.evaluate(() => {
      document.querySelector('[data-category="text"]').hidden = true;
      document.querySelector('[data-category="data"]').hidden = false;
    });
    const data = page.locator('[data-category="data"]');
    for (const [mode, value, expectedText] of [
      ["json", '{"project":"Workbench"}', '"project": "Workbench"'],
      ["encode", "local tools & café", "local%20tools%20%26%20caf%C3%A9"],
      ["decode", "local%20tools%20%26%20caf%C3%A9", "local tools & café"],
    ]) {
      await runWorkbenchOperation(data, {mode, value, expectedText}, expect);
    }
  } finally {
    await closeElectronApp(app);
  }
});

test("personal-space checks exercise every visible entry point and close the sheet between them", async () => {
  const app = await launchElectronApp(electron, {isolatedUserDataDir: true});
  try {
    const newWindow = app.waitForEvent("window");
    await app.evaluate(async ({BrowserWindow}) => {
      const window = new BrowserWindow({show: false});
      await window.loadURL("about:blank");
    });
    const page = await newWindow;
    for (const labels of [["My space"], ["My space", "Personal space"]]) {
      await page.setContent(`
        <style>[data-state=closed] { display: none; }</style>
        <header><button type="button" data-role="tool-space-button">${labels[0]}</button></header>
        ${labels.length === 2 ? '<footer><button type="button" data-role="tool-space-button">Personal space</button></footer>' : ""}
        <div hidden><button type="button" data-role="tool-space-button">Mobile space</button>
          <button data-role="tool-space-close">Hidden close</button></div>
        <section data-role="tool-space-dialog" data-state="closed">
          <p>Local saved tools</p><button type="button" data-role="tool-space-close">Close</button>
        </section>
        <output id="opens">0</output><output id="closes">0</output>`);
      await page.evaluate(() => {
        const space = document.querySelector('[data-role="tool-space-dialog"]');
        const opens = document.querySelector("#opens");
        const closes = document.querySelector("#closes");
        for (const button of document.querySelectorAll('[data-role="tool-space-button"]')) {
          button.addEventListener("click", () => {
            space.dataset.state = "open";
            opens.textContent = String(Number(opens.textContent) + 1);
          });
        }
        space.querySelector("button").addEventListener("click", () => {
          space.dataset.state = "closed";
          closes.textContent = String(Number(closes.textContent) + 1);
        });
      });
      const visited = [];
      await checkWorkbenchPersonalSpace(page, expect, async entry => { visited.push(entry); });
      expect(visited).toEqual(labels.map((label, index) => ({index, label, state: "open"})));
      await expect(page.locator("#opens")).toHaveText(String(labels.length));
      await expect(page.locator("#closes")).toHaveText(String(labels.length));
      await expect(page.locator('[data-role="tool-space-dialog"]')).toBeHidden();
    }
  } finally {
    await closeElectronApp(app);
  }
});
