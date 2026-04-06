import {collectPluginWorkspaceFiles, formatNoPluginTestsMessage, isPluginTestFile} from "../../src/utils/pluginTestRunner";

describe("plugin test runner helpers", () => {
    test("detects plugin test files in common node:test naming conventions", () => {
        expect(isPluginTestFile("/index.test.ts")).toBe(true);
        expect(isPluginTestFile("/src/plugin.spec.tsx")).toBe(true);
        expect(isPluginTestFile("/__tests__/plugin.test.js")).toBe(true);
    });

    test("ignores non-test, node_modules, and dist files", () => {
        expect(isPluginTestFile("/src/index.ts")).toBe(false);
        expect(isPluginTestFile("/node_modules/pkg/index.test.js")).toBe(false);
        expect(isPluginTestFile("/dist/plugin.test.js")).toBe(false);
    });

    test("collects only editable workspace files from latest content", () => {
        expect(collectPluginWorkspaceFiles({
            "/index.ts": "export default 1;",
            "/tests/index.test.ts": "test();",
            "/node_modules/pkg/index.d.ts": "declare const x: string;",
            "/dist/index.cjs": "module.exports = {};",
        })).toEqual([
            {path: "/index.ts", content: "export default 1;"},
            {path: "/tests/index.test.ts", content: "test();"},
        ]);
    });

    test("returns a clear no-tests message for production UX", () => {
        expect(formatNoPluginTestsMessage()).toContain("No plugin tests found.");
        expect(formatNoPluginTestsMessage()).toContain("/index.test.ts");
    });
});
