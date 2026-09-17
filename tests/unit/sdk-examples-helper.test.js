const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  DEFAULT_SDK_EXAMPLES_CANDIDATES,
  discoverSdkExampleEntries,
  resolveSdkExamplesPath,
} = require("../e2e/helpers/sdkExamples");
const {
  FIXTURE_RUNTIME_MATRIX_INCLUDE,
  FIXTURE_RUNTIME_MATRIX_SMOKE_HANDLERS,
} = require("../e2e/helpers/fixtureRuntimeMatrixConfig");

describe("sdkExamples helper", () => {
  test("exports candidate SDK example paths for local and CI resolution", () => {
    expect(Array.isArray(DEFAULT_SDK_EXAMPLES_CANDIDATES)).toBe(true);
    expect(DEFAULT_SDK_EXAMPLES_CANDIDATES.length).toBeGreaterThan(0);
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
    fs.writeFileSync(path.join(tempRoot, "01-basic-plugin.ts"), "export default class Basic {}", "utf8");
    fs.writeFileSync(path.join(tempRoot, "fixtures", "minimal-plugin.fixture.ts"), "export default class Minimal {}", "utf8");
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

    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  test("fixture runtime matrix config keeps an explicit fixture include list", () => {
    expect(Array.isArray(FIXTURE_RUNTIME_MATRIX_INCLUDE)).toBe(true);
    expect(FIXTURE_RUNTIME_MATRIX_INCLUDE.length).toBeGreaterThan(0);
    expect(new Set(FIXTURE_RUNTIME_MATRIX_INCLUDE).size).toBe(FIXTURE_RUNTIME_MATRIX_INCLUDE.length);
    expect(FIXTURE_RUNTIME_MATRIX_INCLUDE.every((item) => item.startsWith("fixtures/"))).toBe(true);
  });

  test("fixture runtime smoke handlers only target explicitly included fixtures", () => {
    const includeSet = new Set(FIXTURE_RUNTIME_MATRIX_INCLUDE);
    for (const [relativePath, config] of Object.entries(FIXTURE_RUNTIME_MATRIX_SMOKE_HANDLERS)) {
      expect(includeSet.has(relativePath)).toBe(true);
      expect(typeof config.handler).toBe("string");
      expect(config.handler.length).toBeGreaterThan(0);
    }
  });
});
