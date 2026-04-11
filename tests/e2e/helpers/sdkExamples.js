const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_SDK_EXAMPLES_CANDIDATES = [
  process.env.FDO_SDK_EXAMPLES_PATH,
  path.resolve(__dirname, "../../../external/fdo-sdk/examples"),
  path.resolve(__dirname, "../../../../fdo-sdk/examples"),
  path.resolve(__dirname, "../../../vendor/fdo-sdk/examples"),
].filter(Boolean);

function resolveSdkExamplesPath(candidates = DEFAULT_SDK_EXAMPLES_CANDIDATES) {
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
        return candidate;
      }
    } catch (_) {}
  }
  throw new Error(`Unable to resolve SDK examples path. Checked: ${candidates.join(", ")}`);
}

function walkFiles(rootDir, currentDir = rootDir) {
  const entries = fs.readdirSync(currentDir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absPath = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkFiles(rootDir, absPath));
      continue;
    }
    files.push(absPath);
  }
  return files;
}

function slugFromRelativePath(relativePath) {
  return relativePath
    .replace(/\\/g, "/")
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/(^-+)|(-+$)/g, "")
    .toLowerCase();
}

function uniqueNonEmpty(values) {
  return Array.from(new Set((values || []).map((item) => String(item || "").trim()).filter(Boolean)));
}

function sanitizeExpectationMarkers(values = []) {
  return uniqueNonEmpty(values).filter((value) => {
    if (!value) return false;
    if (value.includes("${")) return false;
    if (/^[^a-zA-Z0-9]+$/.test(value)) return false;
    return value.length >= 4;
  });
}

function extractExampleExpectations(absPath) {
  const source = fs.readFileSync(absPath, "utf8");

  const handlers = [];
  const handlerRegex = /registerHandler\(\s*["'`]([^"'`]+)["'`]/g;
  let match;
  while ((match = handlerRegex.exec(source)) !== null) {
    handlers.push(match[1]);
  }

  const initMessages = [];
  const initLogRegex = /this\.(?:log|info)\(\s*["'`]([^"'`]*initialized[^"'`]*)["'`]/gi;
  while ((match = initLogRegex.exec(source)) !== null) {
    initMessages.push(match[1]);
  }

  const metadataNameMatch =
    source.match(/_metadata\s*:\s*PluginMetadata\s*=\s*\{[\s\S]*?\bname\s*:\s*["'`]([^"'`]+)["'`]/) ||
    source.match(/\bname\s*:\s*["'`]([^"'`]+)["'`]/);
  const metadataName = metadataNameMatch?.[1] || "";

  const uiMarkers = [];
  const domHeadingRegex = /createHText\(\s*[1-3]\s*,\s*["'`]([^"'`]{3,120})["'`]/g;
  while ((match = domHeadingRegex.exec(source)) !== null) {
    uiMarkers.push(match[1]);
  }
  const htmlHeadingRegex = /<h[1-3][^>]*>\s*([^<\n]{3,120})\s*<\/h[1-3]>/gi;
  while ((match = htmlHeadingRegex.exec(source)) !== null) {
    uiMarkers.push(match[1]);
  }
  if (metadataName) {
    uiMarkers.push(metadataName);
  }

  return {
    handlers: uniqueNonEmpty(handlers),
    initMessages: sanitizeExpectationMarkers(initMessages),
    uiMarkers: sanitizeExpectationMarkers(uiMarkers).slice(0, 8),
  };
}

function discoverSdkExampleEntries(examplesRoot = resolveSdkExamplesPath()) {
  return walkFiles(examplesRoot)
    .filter((absPath) => absPath.endsWith(".ts"))
    .filter((absPath) => !absPath.endsWith("metadata-template.ts"))
    .map((absPath) => {
      const relativePath = path.relative(examplesRoot, absPath).replace(/\\/g, "/");
      return {
        absPath,
        relativePath,
        kind: relativePath.startsWith("fixtures/") ? "fixture" : "example",
        slug: slugFromRelativePath(relativePath),
        expectations: extractExampleExpectations(absPath),
      };
    })
    .sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

async function compileSdkExample(entry) {
  // Load esbuild lazily so helper discovery tests can run in jsdom/Jest environments.
  const esbuild = require("esbuild");
  const shouldInstrumentCoverage = process.env.FDO_E2E_SDK_EXAMPLE_COVERAGE === "1";
  let result;
  try {
    result = await esbuild.build({
      entryPoints: [entry.absPath],
      bundle: true,
      write: false,
      platform: "node",
      format: "cjs",
      target: "node20",
      sourcemap: "inline",
      external: ["@anikitenko/fdo-sdk"],
      logLevel: "silent",
      tsconfigRaw: {
        compilerOptions: {
          target: "ES2022",
          module: "CommonJS",
          jsx: "react-jsx",
          experimentalDecorators: true,
          emitDecoratorMetadata: true,
          useDefineForClassFields: false,
        },
      },
    });
  } catch (error) {
    const details = Array.isArray(error?.errors) && error.errors.length
      ? error.errors.map((item) => item?.text || JSON.stringify(item)).join("; ")
      : (error?.message || String(error));
    throw new Error(`Failed to compile SDK example: ${entry.relativePath}. ${details}`);
  }

  const outputFiles = Array.isArray(result?.outputFiles) ? result.outputFiles : [];
  const output = outputFiles.find((file) => !file.path.endsWith(".map")) || outputFiles[0];
  if (!output) {
    throw new Error(`Failed to compile SDK example: ${entry.relativePath}. No output files were produced.`);
  }
  let compiled = output.text;

  if (shouldInstrumentCoverage) {
    const { createInstrumenter } = require("istanbul-lib-instrument");
    const instrumenter = createInstrumenter({
      compact: false,
      produceSourceMap: false,
      autoWrap: true,
      esModules: false,
    });
    compiled = instrumenter.instrumentSync(compiled, entry.absPath);
    compiled += `
;(() => {
  try {
    const sdk = require("@anikitenko/fdo-sdk");
    const registry = sdk && sdk.PluginRegistry;
    if (registry && typeof registry.registerHandler === "function") {
      registry.registerHandler("__e2e.getCoverage", () => {
        try {
          const cov = (typeof globalThis !== "undefined" && globalThis.__coverage__) ? globalThis.__coverage__ : {};
          return { success: true, coverage: cov };
        } catch (error) {
          return { success: false, error: (error && error.message) ? error.message : String(error) };
        }
      });
    }
  } catch (_) {}
})();
`;
  }

  return compiled;
}

async function ensureRootCertificate(window) {
  await window.evaluate(async () => {
    const hasRootWithKey = async () => {
      const roots = await window.electron.settings.certificates.getRoot();
      return (roots || []).some((item) => item?.label === "root" && item?.key);
    };

    if (!(await hasRootWithKey())) {
      const before = await window.electron.settings.certificates.getRoot();
      const beforeIds = new Set((before || []).map((item) => item?.id).filter(Boolean));
      await window.electron.settings.certificates.create().catch(() => {});
      const after = await window.electron.settings.certificates.getRoot();
      const created = (after || []).find((item) => item?.id && !beforeIds.has(item.id) && item?.key);
      if (created?.id && created?.label !== "root") {
        await window.electron.settings.certificates.rename(created.id, "root").catch(() => {});
      }
    }
    if (!(await hasRootWithKey())) {
      await window.electron.settings.certificates.renew("root").catch(() => {});
    }
  });
}

async function deploySdkExample(window, entry, options = {}) {
  const pluginName = options.pluginName || `sdk-e2e-${entry.slug}`;
  const compiledContent = await compileSdkExample(entry);
  await ensureRootCertificate(window);
  const result = await window.evaluate(async ({ pluginName, compiledContent, relativePath }) => {
    return await window.electron.plugin.deployToMainFromEditor({
      name: pluginName,
      sandbox: `sdk_examples_${pluginName}`,
      entrypoint: "dist/index.cjs",
      content: compiledContent,
      metadata: {
        name: `SDK Example: ${relativePath}`,
        version: "1.0.0",
        author: "SDK E2E",
        description: `Live E2E validation for ${relativePath}`,
        icon: "clean",
      },
      rootCert: "root",
    });
  }, {
    pluginName,
    compiledContent,
    relativePath: entry.relativePath,
  });

  if (!result?.success) {
    throw new Error(`Failed to deploy SDK example ${entry.relativePath}: ${result?.error || "unknown error"}`);
  }
  const activation = await activatePlugin(window, pluginName);
  if (!activation?.success) {
    throw new Error(`Failed to activate SDK example ${entry.relativePath}: ${activation?.error || "unknown error"}`);
  }
  await waitForPluginReady(window, pluginName);
  return { pluginName };
}

async function waitForPluginRegistered(window, pluginName) {
  await window.waitForFunction(async (id) => {
    const all = await window.electron.plugin.getAll();
    return (all?.plugins || []).some((plugin) => plugin?.id === id);
  }, pluginName, { timeout: 15000 });
}

async function activatePlugin(window, pluginName) {
  return await window.evaluate(async ({ pluginName }) => {
    return await window.electron.plugin.activate(pluginName);
  }, { pluginName });
}

async function waitForPluginReady(window, pluginName) {
  await window.waitForFunction(async (id) => {
    const runtimeStatus = await window.electron.plugin.getRuntimeStatus([id]).catch(() => null);
    const status = runtimeStatus?.statuses?.[0];
    return !!(status?.loaded && status?.ready && status?.inited);
  }, pluginName, { timeout: 20000 });
}

async function waitForPluginSettled(window, pluginName) {
  await window.waitForFunction(async (id) => {
    const runtimeStatus = await window.electron.plugin.getRuntimeStatus([id]).catch(() => null);
    const status = runtimeStatus?.statuses?.[0];
    return !!(status?.loaded && status?.ready && status?.inited && !status?.loading);
  }, pluginName, { timeout: 20000 });
}

async function selectPluginOpen(window, pluginName) {
  await window.waitForFunction(() => {
    return !!window.__homeTestApi?.selectPluginById;
  }, { timeout: 15000 });
  const selected = await window.evaluate(async ({ pluginName }) => {
    if (!window.__homeTestApi?.selectPluginById) {
      return { ok: false, reason: "homeTestApi_missing" };
    }
    return { ok: !!window.__homeTestApi.selectPluginById(pluginName, { open: true }) };
  }, { pluginName });
  if (!selected?.ok) {
    throw new Error(`Failed to select SDK example plugin ${pluginName}: ${selected?.reason || "not_found"}`);
  }
}

async function expectPluginUiVisible(window, pluginName) {
  await window.waitForFunction(async (id) => {
    const runtimeStatus = await window.electron.plugin.getRuntimeStatus([id]).catch(() => null);
    const status = runtimeStatus?.statuses?.[0];
    const allIframes = Array.from(document.querySelectorAll('iframe[title^="Plugin Container ID"]'));
    const iframe = allIframes.find((node) => node?.dataset?.pluginId === id && node?.getAttribute("aria-hidden") !== "true")
      || allIframes.find((node) => node?.dataset?.pluginActive === "true" && node?.getAttribute("aria-hidden") !== "true")
      || allIframes.find((node) => node?.getAttribute("title") === "Plugin Container ID")
      || null;
    const doc = iframe?.contentDocument;
    if (!status?.loaded || !status?.ready || !status?.inited) {
      return false;
    }
    if (!doc?.body) {
      return false;
    }
    const root = doc.querySelector("#plugin-root, [data-plugin-root='true'], #root");
    const childCount = root?.childElementCount ?? doc.body.childElementCount ?? 0;
    const textLength = (doc.body.innerText || "").trim().length;
    return childCount > 0 || textLength > 0;
  }, pluginName, { timeout: 15000 });
}

async function waitForPluginUiRendered(window, pluginName, timeout = 15000) {
  await window.waitForFunction(async ({ pluginName }) => {
    const runtimeStatus = await window.electron.plugin.getRuntimeStatus([pluginName]).catch(() => null);
    const status = runtimeStatus?.statuses?.[0];
    if (!status?.loaded || !status?.ready || !status?.inited || status?.loading) {
      return false;
    }

    const allIframes = Array.from(document.querySelectorAll('iframe[title^="Plugin Container ID"]'));
    const iframe = allIframes.find((node) => node?.dataset?.pluginId === pluginName && node?.getAttribute("aria-hidden") !== "true")
      || allIframes.find((node) => node?.dataset?.pluginActive === "true" && node?.getAttribute("aria-hidden") !== "true")
      || allIframes.find((node) => node?.getAttribute("title") === "Plugin Container ID")
      || null;
    const doc = iframe?.contentDocument;
    const body = doc?.body;
    if (!body) {
      return false;
    }

    const html = String(body.innerHTML || "");
    const text = String(body.innerText || "").trim();
    if (html.includes("plugin-page-loader")) {
      return false;
    }
    if (/Failed to render UI|Error rendering plugin|Plugin UI failed to load/i.test(text)) {
      return false;
    }
    const root = body.querySelector("#plugin-root, [data-plugin-root='true'], #root");
    const childCount = root?.childElementCount ?? body.childElementCount ?? 0;
    return childCount > 0 || text.length > 0;
  }, { pluginName }, { timeout });
}

async function getPluginUiState(window, pluginName) {
  return await window.evaluate(async ({ pluginName }) => {
    const runtimeStatus = await window.electron.plugin.getRuntimeStatus([pluginName]).catch(() => null);
    const status = runtimeStatus?.statuses?.[0] || null;
    const container = document.querySelector("#plugin-container");
    const allIframes = Array.from(document.querySelectorAll('iframe[title^="Plugin Container ID"]'));
    const iframe = allIframes.find((node) => node?.dataset?.pluginId === pluginName && node?.getAttribute("aria-hidden") !== "true")
      || allIframes.find((node) => node?.dataset?.pluginActive === "true" && node?.getAttribute("aria-hidden") !== "true")
      || allIframes.find((node) => node?.getAttribute("title") === "Plugin Container ID")
      || null;
    const doc = iframe?.contentDocument;
    const bodyText = String(doc?.body?.innerText || "").trim();
    const bodyHtml = String(doc?.body?.innerHTML || "").trim();
    const containerText = String(container?.innerText || "").trim();

    return {
      runtimeStatus: status,
      iframePresent: !!iframe,
      iframeText: bodyText,
      iframeHtml: bodyHtml,
      hostOverlayVisible: /Plugin UI failed to load|Loading plugin UI|Preparing plugin host|Initializing plugin/i.test(containerText),
      hostOverlayText: containerText.slice(0, 800),
    };
  }, { pluginName });
}

async function getPluginIframeText(window) {
  return await window.evaluate(() => {
    const allIframes = Array.from(document.querySelectorAll('iframe[title^="Plugin Container ID"]'));
    const iframe = allIframes.find((node) => node?.dataset?.pluginActive === "true" && node?.getAttribute("aria-hidden") !== "true")
      || allIframes.find((node) => node?.getAttribute("title") === "Plugin Container ID")
      || null;
    const doc = iframe?.contentDocument;
    if (!doc?.body) {
      return "";
    }
    return String(doc.body.innerText || "").trim();
  });
}

function normalizeUiMessageResponse(response) {
  if (response && typeof response === "object" && "ok" in response) {
    if ("result" in response) {
      return {
        ok: !!response.ok,
        result: response.result,
        error: response.error || "",
        code: response.code || "",
      };
    }
    const { ok, code, correlationId, ...payload } = response;
    return {
      ok: !!ok,
      result: payload,
      error: response.error || "",
      code: code || "",
      correlationId: correlationId || "",
    };
  }
  if (response && typeof response === "object" && "success" in response && !("error" in response)) {
    return { ok: true, result: response, error: "", code: "" };
  }
  return { ok: true, result: response, error: "", code: "" };
}

function isDiagnosticsPayload(payload) {
  return !!(payload && typeof payload === "object" && payload.apiVersion && payload.capabilities && payload.health);
}

async function getPluginDiagnostics(window, pluginName, options = {}) {
  const attempts = Math.max(1, Math.min(10, Number(options.attempts || 6)));
  for (let index = 0; index < attempts; index += 1) {
    const raw = await window.evaluate(async ({ pluginName }) => {
      return await window.electron.plugin.uiMessage(pluginName, {
        handler: "__sdk.getDiagnostics",
        content: { notificationsLimit: 8 },
      });
    }, { pluginName });
    const normalized = normalizeUiMessageResponse(raw);
    const payload = normalized?.result;
    if (isDiagnosticsPayload(payload)) {
      return payload;
    }
    const notReady = !!(payload?.success === false && /not ready/i.test(String(payload?.error || "")));
    if (notReady) {
      await waitForPluginReady(window, pluginName);
    }
    await window.waitForTimeout(120);
  }
  return null;
}

async function getPluginLogTail(window, pluginName, options = {}) {
  const maxFiles = Number(options.maxFiles || 2);
  const maxChars = Number(options.maxChars || 12000);
  return await window.evaluate(async ({ pluginName, maxFiles, maxChars }) => {
    return await window.electron.plugin.getLogTail(pluginName, { maxFiles, maxChars }).catch(() => null);
  }, { pluginName, maxFiles, maxChars });
}

async function removePlugin(window, pluginName) {
  await window.evaluate(async ({ pluginName }) => {
    try { await window.electron.plugin.deactivate(pluginName); } catch (_) {}
    try { await window.electron.plugin.remove(pluginName); } catch (_) {}
  }, { pluginName });
}

module.exports = {
  DEFAULT_SDK_EXAMPLES_CANDIDATES,
  discoverSdkExampleEntries,
  resolveSdkExamplesPath,
  deploySdkExample,
  waitForPluginRegistered,
  waitForPluginReady,
  waitForPluginSettled,
  activatePlugin,
  selectPluginOpen,
  expectPluginUiVisible,
  waitForPluginUiRendered,
  getPluginUiState,
  getPluginIframeText,
  getPluginDiagnostics,
  getPluginLogTail,
  removePlugin,
};
