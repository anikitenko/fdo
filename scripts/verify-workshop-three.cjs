"use strict";

// Real workshop rehearsal: isolated FDO -> actual ZIP -> Docker -> Chrome.
// Native folder/save pickers are automated. No cloud provisioning or API fixtures.
const fs = require("node:fs");
const path = require("node:path");
const net = require("node:net");
const {parseEnv} = require("node:util");
const {execFile} = require("node:child_process");
const {promisify} = require("node:util");
const {_electron: electron, chromium, expect} = require("@playwright/test");
const {launchElectronApp, closeElectronApp, dismissBlueprintOverlays} = require("../tests/e2e/helpers/electronApp");
const {ensureRootCertificate, selectPluginOpen, waitForPluginUiRendered} = require("../tests/e2e/helpers/sdkExamples");

const root = path.resolve(__dirname, "..");
const source = path.join(root, "examples/workshop/2");
const artifacts = path.join(root, "artifacts/workshops/03-standalone-docker");
const output = path.join(artifacts, "run-" + Date.now());
const application = path.join(output, "application");
const archive = path.join(output, "release-monitor.zip");
const project = "fdo-workshop3-" + process.pid;
const port = Number(process.env.FDO_WORKSHOP_PORT || 9090);
const id = "workshop-release-monitor";
const capabilities = ["system.network", "system.network.https", "system.network.scope.public-web-secure"];
const runFile = promisify(execFile);
const report = {startedAt: new Date().toISOString(), artifactDirectory: output, port, checks: {}};
fs.mkdirSync(output, {recursive: true});

const run = (command, args, options = {}) => runFile(command, args, {
  cwd: root, encoding: "utf8", timeout: 120000, maxBuffer: 20 * 1024 * 1024, ...options,
});
const compose = args => run("docker", ["compose", "--project-name", project, ...args], {cwd: application, timeout: 600000});
const shot = (page, name) => page.screenshot({path: path.join(output, name + ".png"), animations: "disabled"});

async function checkPort() {
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("FDO_WORKSHOP_PORT must be an integer from 1024 to 65535.");
  const server = net.createServer();
  await new Promise((resolve, reject) => {server.once("error", reject); server.listen(port, "127.0.0.1", resolve);});
  await new Promise(resolve => server.close(resolve));
}

(async () => {
  let app, browser, context, composeAttempted = false;
  try {
    await checkPort();
    await run("docker", ["version", "--format", "{{.Server.Version}}"]);
    await run("docker", ["compose", "version"]);
    console.log("Importing and checking workshop 2 in a disposable FDO profile…");
    app = await launchElectronApp(electron, {isolatedUserDataDir: true});
    const page = await app.firstWindow();
    await page.getByTestId("header-command-search").waitFor({timeout: 30000});
    await page.setViewportSize({width: 1920, height: 1080});
    await ensureRootCertificate(page);
    const files = Object.fromEntries(fs.readdirSync(source).filter(name => fs.statSync(path.join(source, name)).isFile())
      .map(name => ["/" + name, fs.readFileSync(path.join(source, name), "utf8")]));
    const check = await page.evaluate(latestContent => window.electron.plugin.typecheck({latestContent}), files);
    expect(check.success, check.error).toBe(true);
    expect(check.diagnostics || []).toEqual([]);
    const tests = await page.evaluate(latestContent => window.electron.plugin.runTests({latestContent}), files);
    expect(tests.success, tests.output || tests.error).toBe(true);
    expect(tests.skipped).not.toBe(true);
    report.checks.source = {typecheck: true, tests: tests.output};

    await app.evaluate(({dialog}, directory) => {
      dialog.showOpenDialog = async () => ({canceled: false, filePaths: [directory]});
    }, source);
    await page.getByPlaceholder("Search...", {exact: true}).click();
    await page.getByPlaceholder("Search commands...").fill("Create Plugin");
    await page.getByRole("menuitem", {name: /^Create Plugin/}).click();
    await page.getByRole("button", {name: "Select folder", exact: true}).click();
    await expect(page.getByRole("button", {name: "Build and install plugin", exact: true})).toBeEnabled();
    await page.getByLabel("Plugin ID", {exact: true}).fill(id);
    await page.getByRole("button", {name: "Build and install plugin", exact: true}).click();
    await expect(page.getByRole("dialog", {name: "Create Plugin", exact: true})).toBeHidden({timeout: 30000});
    const imported = await page.evaluate(async pluginId => (await window.electron.plugin.getAll()).plugins.find(plugin => plugin.id === pluginId), id);
    expect(imported, "The source import should install the chosen plugin ID").toBeTruthy();
    expect(imported.capabilities).toEqual([]);
    const granted = await page.evaluate(({id, capabilities}) => window.electron.plugin.setCapabilities(id, capabilities), {id, capabilities});
    expect(granted.success, granted.error).toBe(true);
    const active = await page.evaluate(id => window.electron.plugin.activate(id), id);
    expect(active.success, active.error).toBe(true);
    await selectPluginOpen(page, id);
    await waitForPluginUiRendered(page, id);
    const desktopFrame = page.frameLocator(`iframe[data-plugin-id="${id}"]`);
    await desktopFrame.getByRole("button", {name: "Check latest release", exact: true}).click();
    await expect(desktopFrame.getByRole("status")).toHaveAttribute("data-state", "success", {timeout: 25000});
    report.checks.desktopLiveResult = await desktopFrame.getByRole("status").innerText();
    await shot(page, "01-desktop-release-monitor");

    await app.evaluate(({dialog}, destination) => {
      dialog.showSaveDialog = async () => ({canceled: false, filePath: destination});
    }, archive);
    await dismissBlueprintOverlays(page);
    await page.getByRole("button", {name: /Plugins Activated:/i}).click();
    await page.getByRole("button", {name: "Manage plugins", exact: true}).click();
    await page.getByRole("button", {name: "Export As…", exact: true}).click();
    const dialog = page.getByRole("dialog", {name: "Export As · GitHub Release Monitor", exact: true});
    await dialog.getByLabel("Export format", {exact: true}).selectOption("web");
    await expect(dialog.getByText("Application conversion prepared", {exact: true})).toBeVisible({timeout: 30000});
    await dialog.getByLabel("Container port", {exact: true}).fill(String(port));
    await expect(dialog.getByRole("button", {name: "Export web application", exact: true})).toBeDisabled();
    await dialog.getByRole("button", {name: "Review installed version", exact: true}).click();
    await expect(dialog.getByText("Application conversion prepared", {exact: true})).toBeVisible({timeout: 30000});
    await shot(page, "02-export-port-and-review");
    await dialog.getByRole("button", {name: "Azure deployment guide", exact: true}).click();
    const guide = page.getByRole("dialog", {name: "Cloud deployment guide", exact: true});
    for (const [provider, title] of [["azure", "Azure Container Apps"], ["aws", "AWS ECS Fargate"], ["gcp", "Google Cloud Run"]]) {
      await guide.getByLabel("Deployment platform").selectOption(provider);
      await expect(guide.getByRole("region", {name: title + " deployment instructions"})).toBeVisible();
      await shot(page, "03-guide-" + provider);
    }
    await guide.getByRole("button", {name: "Close guide", exact: true}).click();
    await dialog.getByRole("button", {name: "Export web application", exact: true}).click();
    await expect(dialog.getByRole("status")).toContainText(archive, {timeout: 30000});
    await require("unzipper").Open.file(archive).then(zip => zip.extract({path: application}));
    const text = file => fs.readFileSync(path.join(application, file), "utf8");
    const conversion = JSON.parse(text("conversion-report.json"));
    expect(conversion.blockers).toEqual([]);
    expect(conversion.deployment.port).toBe(port);
    expect(text("Dockerfile")).toContain("EXPOSE " + port);
    expect(text("docker-compose.yml")).toContain(`127.0.0.1:${port}:${port}`);
    for (const [file, canonical] of [["AZURE_CONTAINER_APPS.md", "AZURE_CONTAINER_APPS_DEPLOYMENT.md"], ["AWS_ECS.md", "AWS_ECS_DEPLOYMENT.md"], ["GCP_CLOUD_RUN.md", "GCP_CLOUD_RUN_DEPLOYMENT.md"]]) {
      expect(text("docs/" + file)).toBe(fs.readFileSync(path.join(root, "docs", canonical), "utf8"));
    }
    report.checks.export = {actualArchive: true, port, bundledGuides: ["azure", "aws", "gcp"], blockers: conversion.blockers};
    await closeElectronApp(app);
    app = null;
    report.checks.disposableFdoClosedBeforeDocker = true;

    console.log("Building the actual exported Docker image (first build may take several minutes)…");
    await run(process.execPath, ["setup.cjs"], {cwd: application});
    const initialEnv = text(".env");
    const env = parseEnv(initialEnv);
    expect(env.PORT).toBe(String(port));
    expect(env.WEB_APP_PASSWORD.length).toBeGreaterThanOrEqual(24);
    composeAttempted = true;
    const built = await compose(["up", "--build", "-d"]);
    fs.writeFileSync(path.join(output, "docker-build.log"), built.stdout + built.stderr);
    const url = `http://localhost:${port}`;
    await expect.poll(async () => fetch(url + "/health/ready").then(response => response.status).catch(() => 0), {timeout: 60000}).toBe(200);
    expect((await fetch(url + "/api/view")).status).toBe(401);
    const sdkCheck = await compose(["exec", "-T", "application", "node", "-e",
      "for(const name of ['electron','@anikitenko/fdo-sdk']){try{require.resolve(name);process.exit(1)}catch(error){if(error.code!=='MODULE_NOT_FOUND')throw error}} console.log('No Electron or FDO SDK package installed');"]);
    expect(sdkCheck.stdout).toContain("No Electron or FDO SDK package installed");
    browser = await chromium.launch({channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL || "chrome", headless: true});
    context = await browser.newContext({httpCredentials: {username: env.WEB_APP_USERNAME, password: env.WEB_APP_PASSWORD}, viewport: {width: 1920, height: 1080}});
    const web = await context.newPage();
    await web.goto(url);
    const frame = web.frameLocator('iframe[title="Application"]');
    const input = frame.getByLabel("Repository (owner/name)");
    const button = frame.getByRole("button", {name: "Check latest release", exact: true});
    const status = frame.getByRole("status");
    await button.click();
    await expect(status).toHaveAttribute("data-state", "success", {timeout: 25000});
    await expect(status).toContainText("Repository: anikitenko/fdo");
    report.checks.containerLiveResult = await status.innerText();
    await shot(web, "04-standalone-live-result-fdo-closed");
    await input.fill("anikitenko/fdo-workshop-no-such-repository-7ba9c1");
    await button.click();
    await expect(status).toHaveAttribute("data-state", "error", {timeout: 25000});
    await expect(status).toContainText("Previous successful check (not refreshed)");
    await expect(status).toContainText("No public latest release found");
    await shot(web, "05-expected-api-error");
    await input.fill("anikitenko/fdo");
    await button.click();
    await expect(status).toHaveAttribute("data-state", "success", {timeout: 25000});
    report.checks.browser = {authenticationRequired: true, liveSuccess: true, labelledPreviousResult: true, recovery: true, noDesktopRuntimePackages: true};
    const mounts = async () => {
      const container = (await compose(["ps", "-q", "application"])).stdout.trim();
      return JSON.parse((await run("docker", ["inspect", "--format", "{{json .Mounts}}", container])).stdout).find(mount => mount.Destination === "/data");
    };
    const before = await mounts();
    expect(before.Type).toBe("volume");
    await compose(["down"]);
    await run(process.execPath, ["setup.cjs"], {cwd: application});
    expect(text(".env")).toBe(initialEnv);
    await compose(["up", "-d"]);
    await expect.poll(async () => fetch(url + "/health/ready").then(response => response.status).catch(() => 0), {timeout: 60000}).toBe(200);
    const after = await mounts();
    expect(after.Name).toBe(before.Name);
    await web.reload();
    await expect(status).toContainText("No checks yet");
    await button.click();
    await expect(status).toHaveAttribute("data-state", "success", {timeout: 25000});
    await shot(web, "06-live-check-after-container-recreation");
    report.checks.recreation = {sameVolume: true, setupValuesPreserved: true, transientViewReset: true, liveCheckPassed: true};
    report.success = true;
    console.log("Passed: source import/tests, actual export, Docker build, browser API success/error/recovery, and container recreation.");
  } catch (error) {
    report.success = false;
    // Never serialize child-process error objects: they can include private output.
    report.error = String(error.message || error).slice(0, 3000);
    console.error(report.error);
    process.exitCode = 1;
  } finally {
    await context?.close().catch(() => {});
    await browser?.close().catch(() => {});
    if (app) await closeElectronApp(app).catch(() => {});
    if (composeAttempted) {
      try {
        // These are this run's unique project resources, never the user's stack.
        await compose(["down", "--volumes", "--rmi", "local"]);
        report.cleanup = "Removed this run's Compose containers, volume, network and local image.";
      } catch (error) {
        report.success = false;
        report.cleanup = "Local cleanup failed for project " + project + "; see its Compose resources.";
        console.error(report.cleanup);
        process.exitCode = 1;
      }
    }
    report.finishedAt = new Date().toISOString();
    const json = JSON.stringify(report, null, 2) + "\n";
    fs.writeFileSync(path.join(output, "verification.json"), json);
    fs.writeFileSync(path.join(artifacts, "verification.json"), json);
    console.log("Verification report: " + path.join(artifacts, "verification.json"));
  }
})();
