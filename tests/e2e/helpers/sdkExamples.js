const {waitForAsyncCondition} = require('./waitForAsyncCondition');
const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_SDK_EXAMPLES_CANDIDATES = [
  process.env.FDO_SDK_EXAMPLES_PATH,
  path.resolve(__dirname, "../../../node_modules/@anikitenko/fdo-sdk/examples"),
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
  const ast = require('@babel/parser').parse(source, {sourceType: 'module', plugins: ['typescript', 'jsx', 'decorators-legacy']});
  const constants = new Map();
  const traverse = require('@babel/traverse').default;
  traverse(ast, {ClassProperty(p) {
    const owner = p.findParent(parent => parent.isClassDeclaration());
    if (p.node.static && owner?.node.id && p.node.value?.type === 'StringLiteral') {
      constants.set(`${owner.node.id.name}.${p.node.key.name}`, p.node.value.value);
    }
  }});
  traverse(ast, {CallExpression(p) {
    const {node} = p;
    if (node.callee.type !== 'MemberExpression' || node.callee.property.name !== 'registerHandler') return;
    const arg = node.arguments[0];
    let name = arg?.type === 'StringLiteral' ? arg.value : undefined;
    if (arg?.type === 'MemberExpression') name = constants.get(`${arg.object.name}.${arg.property.name}`);
    if (arg?.type === 'Identifier') {
      const binding = p.scope.getBinding(arg.name)?.path;
      if (binding?.isVariableDeclarator() && binding.node.init?.type === 'StringLiteral') name = binding.node.init.value;
    }
    if (typeof name === 'string') handlers.push(name);
  }});
  let match;

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
  const inheritsSdk = (p, seen = new Set()) => {
    if (!p?.node || seen.has(p.node)) return false;
    seen.add(p.node);
    if (p.isIdentifier()) {
      if (p.node.name === 'FDO_SDK') return true;
      const binding = p.scope.getBinding(p.node.name)?.path;
      if (binding?.isVariableDeclarator()) return inheritsSdk(binding.get('init'), seen);
      if (binding?.isClassDeclaration()) return inheritsSdk(binding.get('superClass'), seen);
      return binding?.isImportSpecifier() && binding.node.imported.name === 'FDO_SDK';
    }
    if (p.isCallExpression()) return p.get('arguments').some(arg => inheritsSdk(arg, seen));
    return false;
  };
  return walkFiles(examplesRoot)
    .filter((absPath) => absPath.endsWith(".ts"))
    .filter((absPath) => !absPath.endsWith("metadata-template.ts"))
    // The SDK also publishes frontend recipes and helper modules. They are not
    // executable plugins and must not be deployed as background processes.
    .filter(absPath => {
      const ast = require('@babel/parser').parse(fs.readFileSync(absPath, 'utf8'), {sourceType: 'module', plugins: ['typescript', 'jsx', 'decorators-legacy']});
      let plugin = false;
      require('@babel/traverse').default(ast, {ClassDeclaration(p) {
        if (inheritsSdk(p.get('superClass'))) plugin = true;
      }});
      return plugin;
    })
    .map((absPath) => {
      const relativePath = path.relative(examplesRoot, absPath).replace(/\\/g, "/");
      return {
        absPath,
        examplesRoot,
        relativePath,
        kind: relativePath.startsWith("fixtures/") ? "fixture" : "example",
        slug: slugFromRelativePath(relativePath),
        expectations: extractExampleExpectations(absPath),
      };
    })
    .sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

let compileFixtureCss;
function sdkExampleCssPlugin(entry, esbuild) {
  return {name: 'sdk-example-style-maps', setup(build) {
    build.onLoad({filter: /\.css$/i}, async ({path: filename}) => {
      if (!compileFixtureCss) {
        const loaded = {exports: {}};
        const source = esbuild.buildSync({entryPoints: [path.resolve(__dirname, '../../../src/utils/esbuild/plugins/cssStyleModule.js')],
          bundle: true, packages: 'external', platform: 'node', format: 'cjs', write: false}).outputFiles[0].text;
        new Function('require', 'module', 'exports', source)(require, loaded, loaded.exports);
        compileFixtureCss = loaded.exports.compileCssStyleModule;
      }
      const root = fs.realpathSync(entry.examplesRoot || path.dirname(entry.absPath));
      const virtualPath = file => '/' + path.relative(root, fs.realpathSync(file)).replace(/\\/g, '/');
      const files = Object.fromEntries(walkFiles(root).filter(file => file.endsWith('.css'))
        .map(file => [virtualPath(file), fs.readFileSync(file, 'utf8')]));
      return {contents: await compileFixtureCss(files, virtualPath(filename)), loader: 'js'};
    });
  }};
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
      plugins: [sdkExampleCssPlugin(entry, esbuild)],
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
      coverageGlobalScope: "globalThis",
      coverageGlobalScopeFunc: false,
    });
    compiled = instrumenter.instrumentSync(compiled, entry.absPath);
    const { isOperationalExample, operationalCoverageSupport } = require("./sdkOperationalCoverage");
    if (isOperationalExample(entry)) compiled += operationalCoverageSupport(compiled, entry.relativePath.startsWith("12-"));
    if (entry.relativePath === '18-interactive-ssh-plugin.ts') compiled += require('./sdkTerminalCoverage').terminalCoverageSupport();
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
    const certificates = window.electron.settings.certificates;
    const before = await certificates.getRoot();
    if (before.some(item => item?.label === "root" && item?.hasPrivateKey)) return;
    if (before.some(item => item?.label === "root")) {
      await certificates.renew("root");
    } else {
      const beforeIds = new Set(before.map(item => item?.id).filter(Boolean));
      await certificates.create();
      const after = await certificates.getRoot();
      const created = (after || []).find((item) => item?.id && !beforeIds.has(item.id) && item?.hasPrivateKey);
      if (!created) throw new Error('Certificate creation did not produce a signing identity with a private key.');
      if (created?.id && created?.label !== "root") {
        await certificates.rename(created.id, "root");
      }
    }
    const roots = await certificates.getRoot();
    if (!roots.some(item => item?.label === "root" && item?.hasPrivateKey)) {
      throw new Error('SDK fixture signing requires a root certificate with an accessible private key.');
    }
  }).catch(error => {
    throw new Error(`Could not prepare the SDK fixture signing certificate: ${error.message}`, {cause: error});
  });
}

async function deploySdkExample(window, entry, options = {}) {
  const pluginName = options.pluginName || `sdk-e2e-${entry.slug}`;
  const compiledContent = options.compiledContent ?? await compileSdkExample(entry);
  const capabilities = Array.isArray(options.capabilities)
    ? Array.from(new Set(options.capabilities.map((item) => String(item || "").trim()).filter(Boolean)))
    : [];
  await ensureRootCertificate(window);
  const result = await window.evaluate(async ({ pluginName, compiledContent, relativePath, capabilities }) => {
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
      capabilities,
      rootCert: "root",
    });
  }, {
    pluginName,
    compiledContent,
    relativePath: entry.relativePath,
    capabilities,
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
  await waitForAsyncCondition(window, async (id) => {
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
  await waitForAsyncCondition(window, async (id) => {
    const runtimeStatus = await window.electron.plugin.getRuntimeStatus([id]).catch(() => null);
    const status = runtimeStatus?.statuses?.[0];
    return !!(status?.loaded && status?.ready && status?.inited);
  }, pluginName, { timeout: 20000 });
}

async function waitForPluginSettled(window, pluginName) {
  await waitForAsyncCondition(window, async (id) => {
    const runtimeStatus = await window.electron.plugin.getRuntimeStatus([id]).catch(() => null);
    const status = runtimeStatus?.statuses?.[0];
    return !!(status?.loaded && status?.ready && status?.inited && !status?.loading);
  }, pluginName, { timeout: 20000 });
}

async function selectPluginOpen(window, pluginName) {
  try {
    // Home publishes its test API before its asynchronous plugin inventory
    // arrives. Selection returning false is not yet evidence of a missing ID.
    await window.waitForFunction(id => {
      return !!window.__homeTestApi?.selectPluginById?.(id, {open: true});
    }, pluginName, {timeout: 15000, polling: 100});
  } catch (error) {
    throw new Error(`Failed to select SDK example plugin ${pluginName}: Home did not make the plugin selectable within 15000ms.`, {cause: error});
  }
}

async function expectPluginUiVisible(window, pluginName) {
  const {expect} = require('@playwright/test');
  await expect.poll(async () => {
    const state = await getPluginUiState(window, pluginName);
    const status = state.runtimeStatus;
    return !!(status?.loaded && status?.ready && status?.inited && state.iframePresent
      && (state.iframeChildCount > 0 || state.iframeText.length > 0));
  }, {timeout:15000, message:`Waiting for ${pluginName} UI`}).toBe(true);
}

async function waitForPluginUiRendered(window, pluginName, timeout = 15000) {
  const {expect} = require('@playwright/test');
  await expect.poll(async () => {
    const state = await getPluginUiState(window, pluginName);
    const status = state.runtimeStatus;
    return !!(status?.loaded && status?.ready && status?.inited && !status?.loading
      && state.iframePresent && !state.iframeHtml.includes('plugin-page-loader')
      && !/Failed to render UI|Error rendering plugin|Plugin UI failed to load/i.test(state.iframeText)
      && (state.iframeChildCount > 0 || state.iframeText.length > 0));
  }, {timeout, message:`Waiting for ${pluginName} rendered UI`}).toBe(true);
}

async function getPluginUiState(window, pluginName) {
  const state = await window.evaluate(async ({pluginName}) => {
    const runtimeStatus = await window.electron.plugin.getRuntimeStatus([pluginName]).catch(() => null);
    const iframe = Array.from(document.querySelectorAll('iframe[data-plugin-id]'))
      .find(node => node.dataset.pluginId === pluginName && node.getAttribute('aria-hidden') !== 'true');
    const containerText = String(document.querySelector('#plugin-container')?.innerText || '').trim();
    return {
      runtimeStatus:runtimeStatus?.statuses?.[0] || null,
      iframePresent:!!iframe,
      hostOverlayVisible:/Plugin UI failed to load|Loading plugin UI|Preparing plugin host|Initializing plugin/i.test(containerText),
      hostOverlayText:containerText.slice(0,800),
    };
  }, {pluginName});
  let content = {iframeText:'', iframeHtml:'', iframeChildCount:0};
  if (state.iframePresent) {
    // Reloaded hosts use the production opaque sandbox. Inspect through
    // Playwright's frame context; the parent cannot read contentDocument.
    const selector = `iframe[data-plugin-id=${JSON.stringify(pluginName)}]:not([aria-hidden="true"])`;
    content = await window.frameLocator(selector).locator('body').evaluate(body => {
      const root = body.querySelector("#plugin-root, [data-plugin-root='true'], #root");
      return {iframeText:String(body.innerText || '').trim(), iframeHtml:String(body.innerHTML || '').trim(),
        iframeChildCount:root?.childElementCount ?? body.childElementCount};
    }, undefined, {timeout:1000}).catch(() => content);
  }
  return {...state, ...content};
}

async function getPluginIframeText(window) {
  const id = await window.evaluate(() => document.querySelector('iframe[data-plugin-id][data-plugin-active="true"]')?.dataset.pluginId);
  return id ? (await getPluginUiState(window,id)).iframeText : '';
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
  ensureRootCertificate,
  DEFAULT_SDK_EXAMPLES_CANDIDATES,
  discoverSdkExampleEntries,
  resolveSdkExamplesPath,
  compileSdkExample,
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
