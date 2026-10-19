const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  DEFAULT_SDK_EXAMPLES_CANDIDATES,
  deploySdkExample,
  discoverSdkExampleEntries,
  resolveSdkExamplesPath,
} = require("../e2e/helpers/sdkExamples");
const {
  loadFixtureRuntimeMatrixContract,
} = require("../e2e/helpers/fixtureRuntimeMatrixConfig");

describe("sdkExamples helper", () => {
  test("exports candidate SDK example paths for local and CI resolution", () => {
    expect(Array.isArray(DEFAULT_SDK_EXAMPLES_CANDIDATES)).toBe(true);
    expect(DEFAULT_SDK_EXAMPLES_CANDIDATES.length).toBeGreaterThan(0);
    expect(DEFAULT_SDK_EXAMPLES_CANDIDATES).toContain(path.resolve('node_modules/@anikitenko/fdo-sdk/examples'));
  });

  test("resolveSdkExamplesPath picks the first existing directory", () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "fdo-sdk-examples-"));
    const missing = path.join(tempRoot, "missing");
    const existing = path.join(tempRoot, "examples");
    fs.mkdirSync(existing, { recursive: true });

    expect(resolveSdkExamplesPath([missing, existing])).toBe(existing);

    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  test("discoverSdkExampleEntries classifies fixtures separately from examples", () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "fdo-sdk-discover-"));
    fs.mkdirSync(path.join(tempRoot, "fixtures"), { recursive: true });
    fs.writeFileSync(path.join(tempRoot, "01-basic-plugin.ts"), "const Base = mixin(FDO_SDK); export default class Basic extends Base { static readonly HANDLER = 'constant.handler'; init() { PluginRegistry.registerHandler<{value: string}>('typed.handler', () => ({value: 'ok'})); PluginRegistry.registerHandler(Basic.HANDLER, () => ({})); } }", "utf8");
    fs.writeFileSync(path.join(tempRoot, "fixtures", "minimal-plugin.fixture.ts"), "export default class Minimal extends FDO_SDK {}", "utf8");
    fs.writeFileSync(path.join(tempRoot, "frontend-recipe.ts"), "export function markup() { return '<p>Example</p>'; }", "utf8");
    fs.writeFileSync(path.join(tempRoot, "logic.ts"), "export class Logic {}", "utf8");
    fs.writeFileSync(path.join(tempRoot, "metadata-template.ts"), "export {}", "utf8");

    const entries = discoverSdkExampleEntries(tempRoot);

    expect(entries).toEqual([
      expect.objectContaining({
        relativePath: "01-basic-plugin.ts",
        kind: "example",
        slug: "01-basic-plugin",
      }),
      expect.objectContaining({
        relativePath: "fixtures/minimal-plugin.fixture.ts",
        kind: "fixture",
        slug: "fixtures-minimal-plugin-fixture",
      }),
    ]);
    expect(entries[0].expectations.handlers).toEqual(['typed.handler', 'constant.handler']);

    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  test("fixture runtime matrix config keeps an explicit fixture include list", () => {
    const matrix = loadFixtureRuntimeMatrixContract();
    const fixturePaths = matrix.cases.map((entry) => entry.fixturePath);

    expect(fixturePaths.length).toBeGreaterThan(0);
    expect(new Set(fixturePaths).size).toBe(fixturePaths.length);
    expect(fixturePaths.every((item) => item.startsWith("fixtures/"))).toBe(true);
    expect(new Set(matrix.caseIds).size).toBe(matrix.caseIds.length);
    expect(new Set(matrix.caseIds)).toEqual(new Set(matrix.cases.map((entry) => entry.id)));
  });

  test("fixture runtime smoke handlers only target explicitly included fixtures", () => {
    const matrix = loadFixtureRuntimeMatrixContract();
    const includeSet = new Set(matrix.cases.map((entry) => entry.fixturePath));
    const handlers = [];

    for (const entry of matrix.cases) {
      // Every smoke probe belongs to a case that resolved from the explicit
      // include list, and therefore to a fixture-scoped path.
      expect(matrix.caseIds).toContain(entry.id);
      expect(includeSet.has(entry.fixturePath)).toBe(true);
      for (const probe of entry.probes.uiMessage) {
        expect(typeof probe.handler).toBe("string");
        expect(probe.handler.length).toBeGreaterThan(0);
        handlers.push(probe.handler);
      }
    }

    expect(handlers.length).toBeGreaterThan(0);
  });
});

describe('SDK fixture signing preflight', () => {
  let certificates, deploy, roots, page;
  beforeEach(() => {
    roots = [];
    certificates = {
      getRoot: jest.fn(async () => roots),
      create: jest.fn(async () => {roots = [{id: 'created', label: 'generated', hasPrivateKey: true}];}),
      rename: jest.fn(async (id, label) => {roots = roots.map(root => root.id === id ? {...root, label} : root);}),
      renew: jest.fn(async () => {roots = [{id: 'renewed', label: 'root', hasPrivateKey: true}];}),
    };
    // Stop after signing setup so these tests never build or activate a plugin.
    deploy = jest.fn(async () => ({success: false, error: 'Deployment reached'}));
    const renderer = {electron: {settings: {certificates}, plugin: {deployToMainFromEditor: deploy}}};
    page = {evaluate: async (callback, argument) => {
      // Playwright serializes callbacks; they cannot capture the helper's page parameter.
      const runInRenderer = new Function('window', 'return (' + callback.toString() + ')')(renderer);
      return runInRenderer(argument);
    }};
  });
  const deployFixture = () => deploySdkExample(page, {slug: 'signing', relativePath: 'fixtures/signing.ts'}, {compiledContent: 'fixture'});

  test('reports credential-store failure before attempting deployment', async () => {
    const error = new Error('Certificate private keys require an available OS credential store.');
    certificates.create.mockRejectedValueOnce(error);
    await expect(deployFixture()).rejects.toMatchObject({
      message: expect.stringContaining('OS credential store'), cause: error,
    });
    expect(deploy).not.toHaveBeenCalled();
    expect(certificates.renew).not.toHaveBeenCalled();
  });

  test('rejects certificate creation that produces no signing key', async () => {
    certificates.create.mockImplementationOnce(async () => {roots = [{id: 'public', label: 'generated', hasPrivateKey: false}];});
    await expect(deployFixture()).rejects.toThrow('did not produce a signing identity');
    expect(deploy).not.toHaveBeenCalled();
  });

  test('renews a public-only root instead of introducing duplicate root labels', async () => {
    roots = [{id: 'public', label: 'root', hasPrivateKey: false}];
    await expect(deployFixture()).rejects.toThrow('Deployment reached');
    expect(certificates.renew).toHaveBeenCalledWith('root');
    expect(certificates.create).not.toHaveBeenCalled();
    expect(deploy).toHaveBeenCalledTimes(1);
  });

  test('verifies the newly created signing identity before deployment', async () => {
    await expect(deployFixture()).rejects.toThrow('Deployment reached');
    expect(certificates.rename).toHaveBeenCalledWith('created', 'root');
    expect(roots).toEqual([{id: 'created', label: 'root', hasPrivateKey: true}]);
    expect(deploy).toHaveBeenCalledTimes(1);
  });
});



test('selectPluginOpen waits through Home API and inventory hydration', async () => {
  const {selectPluginOpen} = require('../e2e/helpers/sdkExamples');
  const previous = window.__homeTestApi;
  const select = jest.fn().mockReturnValueOnce(false).mockReturnValueOnce(true);
  const page = {waitForFunction: jest.fn(async (predicate, id, options) => {
    predicate = new Function('window', 'return (' + predicate.toString() + ')')(window);
    expect(id).toBe('generated-plugin');
    expect(options).toEqual({timeout: 15000, polling: 100});
    delete window.__homeTestApi;
    expect(predicate(id)).toBe(false);
    window.__homeTestApi = {selectPluginById: select};
    expect(predicate(id)).toBe(false);
    expect(predicate(id)).toBe(true);
  })};
  try {
    await selectPluginOpen(page, 'generated-plugin');
    expect(select).toHaveBeenLastCalledWith('generated-plugin', {open: true});
    expect(page.waitForFunction).toHaveBeenCalledTimes(1);
  } finally { window.__homeTestApi = previous; }
});

test('selectPluginOpen still fails with the requested ID after a bounded wait', async () => {
  const {selectPluginOpen} = require('../e2e/helpers/sdkExamples');
  const cause = new Error('Timeout');
  await expect(selectPluginOpen({waitForFunction: async () => {throw cause;}}, 'missing-plugin'))
    .rejects.toMatchObject({message: expect.stringContaining('missing-plugin'), cause});
});

test('getPluginUiState inspects opaque frames through the automation frame context', async () => {
  const {getPluginUiState} = require('../e2e/helpers/sdkExamples');
  const iframe = document.createElement('iframe');
  iframe.dataset.pluginId = 'opaque-plugin';
  iframe.setAttribute('aria-hidden', 'false');
  Object.defineProperty(iframe, 'contentDocument', {get() {throw new Error('Parent cannot inspect the opaque document');}});
  document.body.appendChild(iframe);
  const body = document.createElement('body');
  body.innerHTML = '<div id="plugin-root"><h1>Opaque UI</h1></div>';
  const previous = window.electron.plugin;
  window.electron.plugin = {getRuntimeStatus: async () => ({statuses:[{loaded:true,ready:true,inited:true}]})};
  const inspect = jest.fn(async callback => callback(body));
  const page = {
    electron:window.electron, // Browser global used by the evaluated callback.
    evaluate: async (callback, argument) => callback(argument),
    frameLocator: jest.fn(() => ({locator: jest.fn(() => ({evaluate:inspect}))})),
  };
  try {
    const state = await getPluginUiState(page,'opaque-plugin');
    expect(state).toMatchObject({iframePresent:true,iframeChildCount:1,runtimeStatus:{ready:true}});
    expect(state.iframeHtml).toContain('Opaque UI');
    expect(page.frameLocator).toHaveBeenCalledWith('iframe[data-plugin-id="opaque-plugin"]:not([aria-hidden="true"])');
    expect(inspect).toHaveBeenCalledTimes(1);
  } finally {iframe.remove(); window.electron.plugin = previous;}
});
