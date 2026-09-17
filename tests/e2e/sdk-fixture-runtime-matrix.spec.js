const { test, expect, _electron: electron } = require("@playwright/test");
const fs = require("node:fs");
const path = require("node:path");
const {
  launchElectronApp,
  closeElectronApp,
  clearToastLog,
  dismissBlueprintOverlays,
  getToastLog,
} = require("./helpers/electronApp");
const {
  discoverSdkExampleEntries,
  resolveSdkExamplesPath,
  deploySdkExample,
  waitForPluginRegistered,
  waitForPluginReady,
  waitForPluginSettled,
  selectPluginOpen,
  expectPluginUiVisible,
  waitForPluginUiRendered,
  getPluginUiState,
  getPluginDiagnostics,
  getPluginLogTail,
  removePlugin,
} = require("./helpers/sdkExamples");
const {
  loadFixtureRuntimeMatrixContract,
  normalizeFixturePath,
  SUPPORTED_FIXTURE_MATRIX_CONTRACT_VERSIONS,
} = require("./helpers/fixtureRuntimeMatrixConfig");

const REPORT_BASENAME = "sdk-fixture-runtime-matrix";
const sdkExamplesRoot = resolveSdkExamplesPath();
const reportRecords = [];
const matrixRunContext = {
  contractVersion: "",
  matrixCaseIds: [],
  missingFixtures: [],
  totalCases: 0,
};

function toCombinedLogText(logTail) {
  const logs = Array.isArray(logTail?.logs) ? logTail.logs : [];
  if (logs.length > 0) {
    return logs.map((item) => String(item?.tail || "")).join("\n");
  }
  const files = Array.isArray(logTail?.files) ? logTail.files : [];
  return files.map((file) => String(file?.content || file?.tail || "")).join("\n");
}

function summarizeError(error) {
    if (!error) {
        return null;
    }
    const details = error?.details && typeof error.details === "object"
      ? error.details
      : null;
    return {
        message: error?.message || String(error),
        stack: typeof error?.stack === "string" ? error.stack : "",
        correlationId: typeof error?.correlationId === "string" ? error.correlationId : "",
        code: typeof error?.code === "string" ? error.code : "",
        handlerId: typeof error?.handlerId === "string" ? error.handlerId : "",
        fixtureId: typeof error?.fixtureId === "string" ? error.fixtureId : "",
        details,
    };
}

function createFixtureRecord(matrixCase, entry) {
  return {
    fixtureId: matrixCase.id,
    fixture: matrixCase.fixturePath,
    sourcePath: entry?.relativePath || "",
    pluginName: `sdk-matrix-${matrixCase.id}`,
    init: { status: matrixCase.probes.init ? "pending" : "skipped", detail: "" },
    render: { status: matrixCase.probes.render ? "pending" : "skipped", detail: "" },
    renderOnLoad: { status: matrixCase.probes.renderOnLoad ? "pending" : "skipped", detail: "" },
    renderPrepSafety: { status: matrixCase.probes.render ? "pending" : "skipped", detail: "" },
    diagnostics: { status: "pending", detail: "" },
    uiMessage: { status: matrixCase.probes.uiMessage.length > 0 ? "pending" : "skipped", detail: "" },
    firstError: null,
  };
}

function markFailure(record, error, context = {}) {
  if (context.initStatus && record.init.status === "pending") record.init.status = context.initStatus;
  if (context.renderStatus && record.render.status === "pending") record.render.status = context.renderStatus;
  if (context.renderOnLoadStatus && record.renderOnLoad.status === "pending") record.renderOnLoad.status = context.renderOnLoadStatus;
  if (context.renderPrepStatus && record.renderPrepSafety.status === "pending") record.renderPrepSafety.status = context.renderPrepStatus;
  if (context.diagnosticsStatus && record.diagnostics.status === "pending") record.diagnostics.status = context.diagnosticsStatus;
  if (context.uiMessageStatus && record.uiMessage.status === "pending") record.uiMessage.status = context.uiMessageStatus;
  if (!record.firstError) {
    record.firstError = summarizeError(error);
  }
}

function assertDiagnosticsShape(payload) {
  expect(payload).toBeTruthy();
  expect(typeof payload).toBe("object");
  expect(typeof payload.apiVersion).toBe("string");
  expect(payload.capabilities && typeof payload.capabilities === "object").toBeTruthy();
  expect(payload.health && typeof payload.health === "object").toBeTruthy();
  expect(Array.isArray(payload.capabilities.registeredHandlers)).toBe(true);
}

function createProbeError(message, details = {}) {
  const error = new Error(message);
  if (details.code) error.code = String(details.code);
  if (details.correlationId) error.correlationId = String(details.correlationId);
  if (details.handlerId) error.handlerId = String(details.handlerId);
  if (details.fixtureId) error.fixtureId = String(details.fixtureId);
  if (details.details && typeof details.details === "object") {
    error.details = details.details;
  }
  return error;
}

function isSupportedUiMessagePayload(payload) {
  if (typeof payload === "undefined") {
    return false;
  }
  if (payload === null) {
    return false;
  }
  if (typeof payload !== "object") {
    return true;
  }
  if (Array.isArray(payload)) {
    return true;
  }
  const keys = Object.keys(payload);
  if (keys.length === 0) {
    return true;
  }
  if (typeof payload.ok === "boolean" || typeof payload.success === "boolean") {
    return true;
  }
  if (
    Object.prototype.hasOwnProperty.call(payload, "result")
    || Object.prototype.hasOwnProperty.call(payload, "error")
    || Object.prototype.hasOwnProperty.call(payload, "code")
    || Object.prototype.hasOwnProperty.call(payload, "correlationId")
  ) {
    return true;
  }
  return true;
}

async function invokeUiHandlerViaCreateBackendReq(window, pluginId, handler, content = {}) {
  return await window.evaluate(async ({ pluginId, handler, content }) => {
    const allIframes = Array.from(document.querySelectorAll('iframe[title^="Plugin Container ID"]'));
    const iframe = allIframes.find((node) => node?.dataset?.pluginId === pluginId && node?.getAttribute("aria-hidden") !== "true")
      || allIframes.find((node) => node?.dataset?.pluginActive === "true" && node?.getAttribute("aria-hidden") !== "true")
      || allIframes.find((node) => node?.getAttribute("title") === "Plugin Container ID")
      || null;
    const pluginWindow = iframe?.contentWindow;
    if (!pluginWindow || typeof pluginWindow.createBackendReq !== "function") {
      return {
        contractError: true,
        error: `createBackendReq bridge unavailable for plugin "${pluginId}"`,
        code: "FIXTURE_UI_MESSAGE_BRIDGE_UNAVAILABLE",
      };
    }
    try {
      const response = await pluginWindow.createBackendReq("UI_MESSAGE", { handler, content });
      if (!response || typeof response !== "object") {
        return {
          contractError: true,
          error: `UI_MESSAGE probe "${handler}" returned non-object response`,
          code: "FIXTURE_UI_MESSAGE_CONTRACT_INVALID",
          raw: response,
        };
      }
      return {
        contractError: false,
        response,
      };
    } catch (error) {
      return {
        contractError: true,
        error: error?.message || String(error),
        code: error?.code || "FIXTURE_UI_MESSAGE_THROWN",
      };
    }
  }, { pluginId, handler, content });
}

async function captureRenderEnvelope(window, pluginId, timeoutMs = 20000) {
  return await window.evaluate(async ({ pluginId, timeoutMs }) => {
    return await new Promise((resolve, reject) => {
      let settled = false;
      const finish = (callback, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try {
          window.electron.plugin.off.render(onRender);
        } catch (_) {}
        callback(value);
      };
      const onRender = (payload) => {
        if (payload?.id !== pluginId) {
          return;
        }
        finish(resolve, { event: payload });
      };
      const timer = setTimeout(() => {
        finish(reject, new Error(`Timed out waiting for render event for ${pluginId}`));
      }, timeoutMs);
      window.electron.plugin.on.render(onRender);
      window.electron.plugin.render(pluginId)
        .then((response) => {
          if (!response?.success) {
            const error = new Error(response?.error || `Render request failed for ${pluginId}`);
            error.code = response?.code || "";
            finish(reject, error);
          }
        })
        .catch((error) => finish(reject, error));
    });
  }, { pluginId, timeoutMs });
}

async function waitForRuntimeReady(window, pluginId, timeoutMs = 20000) {
  try {
    await window.waitForFunction(async (id) => {
      const runtimeStatus = await window.electron.plugin.getRuntimeStatus([id]).catch(() => null);
      const status = runtimeStatus?.statuses?.[0];
      return !!(status?.loaded && status?.ready);
    }, pluginId, { timeout: timeoutMs });
    return true;
  } catch (_) {
    return false;
  }
}

function isPluginNotReadyInitError(response) {
  const message = String(response?.error || "").toLowerCase();
  return response?.success === false && message.includes("not ready");
}

async function requestPluginInitWithRetry(window, pluginName, options = {}) {
  const maxAttempts = Math.max(1, Number(options?.maxAttempts || 8));
  let lastResponse = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const response = await window.evaluate(async ({ pluginName }) => {
      return await window.electron.plugin.init(pluginName);
    }, { pluginName });
    lastResponse = response;
    if (response?.success === true) {
      return { response, attempts: attempt };
    }
    if (!isPluginNotReadyInitError(response)) {
      return { response, attempts: attempt };
    }
    await waitForRuntimeReady(window, pluginName, 3000);
    await new Promise((resolve) => setTimeout(resolve, Math.min(1200, attempt * 180)));
  }
  return { response: lastResponse, attempts: maxAttempts };
}

async function runFixtureLifecycle(entry, matrixCase) {
  const record = createFixtureRecord(matrixCase, entry);
  let app = null;
  let window = null;

  try {
    app = await launchElectronApp(electron, { isolatedUserDataDir: true });
    window = await app.firstWindow();
    await window.waitForLoadState("domcontentloaded");
    await dismissBlueprintOverlays(window);
    await clearToastLog(window);
    await removePlugin(window, record.pluginName);

    await deploySdkExample(window, entry, {
      pluginName: record.pluginName,
      capabilities: matrixCase.requiredCapabilities || [],
    });
    await waitForPluginRegistered(window, record.pluginName);

    if (Array.isArray(matrixCase.requiredCapabilities) && matrixCase.requiredCapabilities.length > 0) {
      const capabilityGrant = await window.evaluate(async ({ pluginName, capabilities }) => {
        return await window.electron.plugin.setCapabilities(pluginName, capabilities);
      }, {
        pluginName: record.pluginName,
        capabilities: matrixCase.requiredCapabilities,
      });
      if (capabilityGrant?.success !== true) {
        throw createProbeError(
          `Capability grant failed for "${matrixCase.id}"`,
          {
            fixtureId: matrixCase.id,
            code: capabilityGrant?.code || "FIXTURE_REQUIRED_CAPABILITY_GRANT_FAILED",
            details: {
              requiredCapabilities: matrixCase.requiredCapabilities,
              capabilityGrant,
            },
          }
        );
      }
    }

    if (matrixCase.probes.init) {
      const runtimeReady = await waitForRuntimeReady(window, record.pluginName, 20000);
      if (!runtimeReady) {
        const runtimeStatus = await window.evaluate(async ({ pluginName }) => {
          return await window.electron.plugin.getRuntimeStatus([pluginName]).catch(() => null);
        }, { pluginName: record.pluginName });
        throw createProbeError(
          `Plugin runtime did not become ready before init for "${matrixCase.id}"`,
          {
            fixtureId: matrixCase.id,
            code: "FIXTURE_PLUGIN_RUNTIME_NOT_READY",
            details: {
              runtimeStatus,
            },
          }
        );
      }
      const initAttempt = await requestPluginInitWithRetry(window, record.pluginName, {
        maxAttempts: 10,
      });
      const initResponse = initAttempt?.response;
      if (initResponse?.success !== true) {
        const runtimeStatus = await window.evaluate(async ({ pluginName }) => {
          return await window.electron.plugin.getRuntimeStatus([pluginName]).catch(() => null);
        }, { pluginName: record.pluginName });
        throw createProbeError(
          `PLUGIN_INIT failed for "${matrixCase.id}"`,
          {
            fixtureId: matrixCase.id,
            code: initResponse?.code || "FIXTURE_PLUGIN_INIT_FAILED",
            details: {
              attempts: initAttempt?.attempts || 1,
              initResponse,
              runtimeStatus,
            },
          }
        );
      }
      await waitForPluginReady(window, record.pluginName);
      await waitForPluginSettled(window, record.pluginName);
      record.init = {
        status: "passed",
        detail: initResponse?.alreadyInited ? "already-inited" : (initResponse?.initInFlight ? "init-in-flight" : "ok"),
      };
    }

    let renderContent = {};
    if (matrixCase.probes.render) {
      const renderEnvelope = await captureRenderEnvelope(window, record.pluginName);
      renderContent = renderEnvelope?.event?.content || {};
      expect(renderEnvelope?.event?.id).toBe(record.pluginName);
      expect(renderContent && typeof renderContent === "object").toBeTruthy();
      expect(
        typeof renderContent.render === "string"
        || typeof renderContent.render === "undefined"
        || renderContent.render === null
      ).toBe(true);
      expect(
        typeof renderContent.onLoad === "string"
        || typeof renderContent.onLoad === "undefined"
        || renderContent.onLoad === null
      ).toBe(true);
      record.render = {
        status: "passed",
        detail: `render=${typeof renderContent.render}; onLoad=${typeof renderContent.onLoad}`,
      };

      await selectPluginOpen(window, record.pluginName);
      await expectPluginUiVisible(window, record.pluginName);
      await waitForPluginUiRendered(window, record.pluginName, 20000);

      const uiState = await getPluginUiState(window, record.pluginName);
      const logTail = await getPluginLogTail(window, record.pluginName, { maxFiles: 4, maxChars: 40000 });
      const logText = toCombinedLogText(logTail);
      const toastLog = await getToastLog(window);
      const toastText = toastLog.map((item) => String(item?.text || "")).join("\n");

      expect(uiState?.runtimeStatus?.loading).toBe(false);
      expect(uiState?.hostOverlayVisible).toBe(false);
      expect(String(uiState?.iframeText || "")).not.toMatch(/Failed to render UI|Plugin UI failed to load/i);
      expect(String(uiState?.iframeHtml || "")).not.toContain("plugin-page-loader");
      expect(logText).not.toMatch(/contains blocked .*?This is only a fail-fast guard/i);
      expect(logText).not.toMatch(/plugin\.render\.error|plugin\.init\.error|Error executing onLoad/i);
      expect(toastText).not.toMatch(/Failed to render UI|Plugin UI failed to load|blocked/i);
      record.renderPrepSafety = {
        status: "passed",
        detail: "ui-and-log-checks-ok",
      };
    }

    if (matrixCase.probes.renderOnLoad) {
      if (typeof renderContent?.onLoad !== "string" || !renderContent.onLoad.trim()) {
        throw createProbeError(
          `renderOnLoad probe enabled but render payload has no executable onLoad source for "${matrixCase.id}"`,
          {
            fixtureId: matrixCase.id,
            code: "FIXTURE_RENDER_ONLOAD_MISSING_SOURCE",
            details: {
              renderType: typeof renderContent?.render,
              onLoadType: typeof renderContent?.onLoad,
            },
          }
        );
      }
      const logTailBefore = await getPluginLogTail(window, record.pluginName, { maxFiles: 4, maxChars: 40000 });
      const hostRenderProbe = await captureRenderEnvelope(window, record.pluginName, 25000);
      const hostRenderContent = hostRenderProbe?.event?.content || {};
      if (typeof hostRenderContent?.onLoad !== "string" || !hostRenderContent.onLoad.trim()) {
        throw createProbeError(
          `renderOnLoad host render probe did not return executable onLoad source for "${matrixCase.id}"`,
          {
            fixtureId: matrixCase.id,
            code: "FIXTURE_RENDER_ONLOAD_MISSING_SOURCE",
            details: {
              onLoadType: typeof hostRenderContent?.onLoad,
            },
          }
        );
      }
      await selectPluginOpen(window, record.pluginName);
      await waitForPluginUiRendered(window, record.pluginName, 20000);
      await window.waitForTimeout(250);
      const logTailAfter = await getPluginLogTail(window, record.pluginName, { maxFiles: 4, maxChars: 40000 });
      const logTextBefore = toCombinedLogText(logTailBefore);
      const logTextAfter = toCombinedLogText(logTailAfter);
      const hasOnLoadError = /Error executing onLoad|plugin\.render\.error|plugin\.init\.error/i.test(logTextAfter);
      const hasNewOnLoadError = logTextAfter.length > logTextBefore.length
        ? /Error executing onLoad|plugin\.render\.error|plugin\.init\.error/i.test(logTextAfter.slice(logTextBefore.length))
        : false;
      if (hasOnLoadError || hasNewOnLoadError) {
        throw createProbeError(
          `renderOnLoad probe failed for "${matrixCase.id}": host render path reported onLoad/runtime errors`,
          {
            fixtureId: matrixCase.id,
            code: "FIXTURE_RENDER_ONLOAD_FAILED",
            details: {
              hostRenderEventId: hostRenderProbe?.event?.id || "",
            },
          }
        );
      }
      record.renderOnLoad = {
        status: "passed",
        detail: "host-render-csp-safe-execution-ok",
      };
    }

    const diagnosticsProbe = await invokeUiHandlerViaCreateBackendReq(
      window,
      record.pluginName,
      "__sdk.getDiagnostics",
      { notificationsLimit: 8 }
    );
    if (diagnosticsProbe?.contractError) {
      throw createProbeError(
        `Diagnostics probe contract failure for "${matrixCase.id}": ${diagnosticsProbe?.error || "unknown error"}`,
        { fixtureId: matrixCase.id, code: diagnosticsProbe?.code || "FIXTURE_DIAGNOSTICS_CONTRACT_FAILED" }
      );
    }
    assertDiagnosticsShape(diagnosticsProbe?.response);
    const diagnostics = await getPluginDiagnostics(window, record.pluginName, { attempts: 8 });
    assertDiagnosticsShape(diagnostics);
    const minInitCount = matrixCase.probes.init ? 1 : 0;
    const minRenderCount = matrixCase.probes.render ? 1 : 0;
    expect(Number(diagnostics?.health?.initCount || 0)).toBeGreaterThanOrEqual(minInitCount);
    expect(Number(diagnostics?.health?.renderCount || 0)).toBeGreaterThanOrEqual(minRenderCount);
    record.diagnostics = {
      status: "passed",
      detail: `handlers=${diagnostics?.capabilities?.registeredHandlers?.length || 0}`,
    };

    if (matrixCase.probes.uiMessage.length > 0) {
      for (const probe of matrixCase.probes.uiMessage) {
        const responseEnvelope = await invokeUiHandlerViaCreateBackendReq(
          window,
          record.pluginName,
          probe.handler,
          probe.content || {}
        );
        if (responseEnvelope?.contractError) {
          throw createProbeError(
            `UI_MESSAGE probe contract failure for "${matrixCase.id}" handler "${probe.handler}": ${responseEnvelope?.error || "unknown error"}`,
            {
              fixtureId: matrixCase.id,
              handlerId: probe.handler,
              code: responseEnvelope?.code || "FIXTURE_UI_MESSAGE_CONTRACT_FAILED",
            }
          );
        }
        const payload = responseEnvelope?.response;
        if (!isSupportedUiMessagePayload(payload)) {
          throw createProbeError(
            `UI_MESSAGE probe returned unsupported envelope for "${matrixCase.id}" handler "${probe.handler}"`,
            {
              fixtureId: matrixCase.id,
              handlerId: probe.handler,
              code: "FIXTURE_UI_MESSAGE_ENVELOPE_INVALID",
              details: {
                payloadType: typeof payload,
                payload,
              },
            }
          );
        }
      }
      record.uiMessage = {
        status: "passed",
        detail: `${matrixCase.probes.uiMessage.length} handler probe(s)`,
      };
    }
  } catch (error) {
    markFailure(record, error, {
      initStatus: "failed",
      renderStatus: "failed",
      renderOnLoadStatus: "failed",
      renderPrepStatus: "failed",
      diagnosticsStatus: "failed",
      uiMessageStatus: "failed",
    });
    throw error;
  } finally {
    if (window) {
      try {
        await removePlugin(window, record.pluginName);
      } catch (_) {}
    }
    if (app) {
      await closeElectronApp(app);
    }
  }

  return record;
}

function createMarkdownReport(records, missing) {
  const lines = [
    "# Fixture Runtime Matrix",
    "",
    `Generated at: ${new Date().toISOString()}`,
    "",
    `Matrix contract version: ${matrixRunContext.contractVersion || "unknown"}`,
    `Supported contract versions: ${SUPPORTED_FIXTURE_MATRIX_CONTRACT_VERSIONS.join(", ")}`,
    `Cases checked: ${records.length}`,
    "",
    "| Fixture ID | Fixture Path | Init | Render | renderOnLoad | Render Prep | Diagnostics | UI_MESSAGE | First Error |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
  ];

  for (const record of records) {
    lines.push(
      `| ${record.fixtureId} | ${record.fixture} | ${record.init.status} | ${record.render.status} | ${record.renderOnLoad.status} | ${record.renderPrepSafety.status} | ${record.diagnostics.status} | ${record.uiMessage.status} | ${record.firstError?.message ? record.firstError.message.replace(/\|/g, "/") : ""} |`
    );
  }

  if (missing.length > 0) {
    lines.push("");
    lines.push("## Unresolved Matrix Fixtures");
    lines.push("");
    for (const item of missing) {
      lines.push(`- ${item.id}: ${item.fixturePath}`);
    }
  }

  return `${lines.join("\n")}\n`;
}

function writeReportArtifacts(records, missing) {
  const outDir = path.resolve(process.cwd(), "test-results");
  fs.mkdirSync(outDir, { recursive: true });
  const jsonPayload = {
    generatedAt: new Date().toISOString(),
    sdkExamplesRoot,
    matrix: {
      contractVersion: matrixRunContext.contractVersion,
      supportedContractVersions: SUPPORTED_FIXTURE_MATRIX_CONTRACT_VERSIONS,
      caseIds: matrixRunContext.matrixCaseIds,
      totalCases: matrixRunContext.totalCases,
      unresolvedCases: missing,
    },
    totalFixtures: records.length,
    failedFixtures: records.filter((record) => record.firstError).length,
    records,
  };
  fs.writeFileSync(path.join(outDir, `${REPORT_BASENAME}.json`), JSON.stringify(jsonPayload, null, 2), "utf8");
  fs.writeFileSync(path.join(outDir, `${REPORT_BASENAME}.md`), createMarkdownReport(records, missing), "utf8");
}

test.afterAll(async () => {
  writeReportArtifacts(reportRecords, matrixRunContext.missingFixtures);
});

test("SDK fixture runtime matrix: init/render/diagnostics smoke", async () => {
  test.setTimeout(420000);

  const matrix = loadFixtureRuntimeMatrixContract();
  matrixRunContext.contractVersion = matrix.contractVersion;
  matrixRunContext.matrixCaseIds = matrix.caseIds;
  matrixRunContext.totalCases = matrix.cases.length;

  const discoveredEntries = discoverSdkExampleEntries(sdkExamplesRoot)
    .filter((entry) => entry.kind === "fixture");
  const entryByPath = new Map(discoveredEntries.map((entry) => [entry.relativePath, entry]));

  const selectedCases = [];
  const missingEntries = [];
  for (const matrixCase of matrix.cases) {
    const normalizedPath = normalizeFixturePath(matrixCase.fixturePath);
    const entry = entryByPath.get(normalizedPath);
    if (!entry) {
      missingEntries.push({ id: matrixCase.id, fixturePath: matrixCase.fixturePath });
      continue;
    }
    selectedCases.push({ matrixCase, entry });
  }
  matrixRunContext.missingFixtures = missingEntries;

  expect(missingEntries).toEqual([]);
  expect(selectedCases.length).toBe(matrix.cases.length);

  const concurrency = Math.max(1, Math.min(2, Number(process.env.FDO_E2E_FIXTURE_MATRIX_CONCURRENCY || 2)));
  const queue = [...selectedCases];
  const failures = [];

  const runNext = async () => {
    while (queue.length > 0) {
      const item = queue.shift();
      if (!item) {
        return;
      }
      const { matrixCase, entry } = item;
      try {
        const record = await runFixtureLifecycle(entry, matrixCase);
        reportRecords.push(record);
      } catch (error) {
        const existing = reportRecords.find((record) => record.fixtureId === matrixCase.id);
        if (!existing) {
          const failureRecord = createFixtureRecord(matrixCase, entry);
          markFailure(failureRecord, error, {
            initStatus: "failed",
            renderStatus: "failed",
            renderOnLoadStatus: "failed",
            renderPrepStatus: "failed",
            diagnosticsStatus: "failed",
            uiMessageStatus: "failed",
          });
          reportRecords.push(failureRecord);
        }
        failures.push({
          fixtureId: matrixCase.id,
          fixturePath: matrixCase.fixturePath,
          handlerId: error?.handlerId || "",
          correlationId: error?.correlationId || "",
          code: error?.code || "",
          message: error?.message || String(error),
          details: error?.details && typeof error.details === "object" ? error.details : null,
        });
      }
    }
  };

  await Promise.all(Array.from({ length: concurrency }, () => runNext()));
  writeReportArtifacts(reportRecords, missingEntries);

  if (failures.length > 0) {
    const summary = failures
      .map((item) =>
        `${item.fixtureId} (${item.fixturePath})` +
        `${item.handlerId ? ` [handler=${item.handlerId}]` : ""}` +
        `${item.correlationId ? ` [correlationId=${item.correlationId}]` : ""}` +
        `${item.code ? ` [code=${item.code}]` : ""}` +
        `${item.details ? ` [details=${JSON.stringify(item.details)}]` : ""}: ${item.message}`
      )
      .join("\n");
    throw new Error(`Fixture runtime matrix failures:\n${summary}`);
  }
});
