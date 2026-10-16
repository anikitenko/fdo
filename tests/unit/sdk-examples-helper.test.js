const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  DEFAULT_SDK_EXAMPLES_CANDIDATES,
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
