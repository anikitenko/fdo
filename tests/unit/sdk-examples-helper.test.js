const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  DEFAULT_SDK_EXAMPLES_CANDIDATES,
  discoverSdkExampleEntries,
  resolveSdkExamplesPath,
} = require("../e2e/helpers/sdkExamples");

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
});
