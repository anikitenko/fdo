import {
    buildAiCodingPluginScopeViolationMessage,
    findOutOfScopePluginFileReferences,
    validateAiCodingPluginScopeRequest,
    validateAiCodingPluginScopeResponse,
} from "../../src/components/editor/utils/aiCodingAgentPluginScope.js";

describe("ai coding agent plugin scope", () => {
    const workspaceFiles = [
        { path: "/index.ts", content: "export default class Plugin {}" },
        { path: "/src/render.tsx", content: "export const View = () => null;" },
        { path: "/tests/plugin.test.ts", content: "test('x', () => {})" },
    ];

    test("allows plugin workspace references", () => {
        expect(validateAiCodingPluginScopeRequest({
            prompt: "please fix /src/render.tsx and /tests/plugin.test.ts",
            workspaceFiles,
        })).toMatchObject({ ok: true });
    });

    test("blocks host-app references in the request", () => {
        expect(validateAiCodingPluginScopeRequest({
            prompt: "please fix src/Home.jsx and src/components/SideBar.jsx",
            workspaceFiles,
        })).toMatchObject({
            ok: false,
            references: ["src/Home.jsx", "src/components/SideBar.jsx"],
        });
    });

    test("allows plugin test diagnostics and negative package-file instructions", () => {
        expect(validateAiCodingPluginScopeRequest({
            prompt: [
                "Repair only the generated /tests/plugin.test.ts now.",
                "The generated node:test suite failed:",
                "\x1b[31m✖ test at plugin.test.js:42:7\x1b[39m",
                "    at /private/tmp/fdo-plugin-tests/plugin.test.js:42:7",
                "Do not edit /package.json or add files.",
            ].join("\n"),
            workspaceFiles,
        })).toMatchObject({ok: true, references: []});
    });

    test("detects host-app references in the response", () => {
        expect(validateAiCodingPluginScopeResponse({
            text: "Change src/Home.jsx and /Users/alexvwan/dev/fdo/src/components/SideBar.jsx",
            workspaceFiles,
        })).toMatchObject({
            ok: false,
        });
    });

    const newWorkspaceFiles = [
        "### File: /src/tools/format.ts",
        "```typescript",
        "export const format = (value: unknown) => JSON.stringify(value);",
        "```",
        "### File: /tests/tools.test.ts",
        "```typescript",
        "import test from 'node:test';",
        "import assert from 'node:assert/strict';",
        "import {format} from '../src/tools/format';",
        "test('format', () => assert.equal(format({}), '{}'));",
        "```",
    ].join("\n");

    test("accepts complete new src and tests files absent from the original workspace", () => {
        expect(validateAiCodingPluginScopeResponse({text: newWorkspaceFiles, workspaceFiles}))
            .toEqual({ok: true, references: []});
    });

    test.each([
        "Create /tests/tools.test.ts next.",
        "### File: /tests/tools.test.ts\n```typescript\nexport {};",
        "// FILE: /tests/tools.test.ts\nexport {};",
        "File: /tests/tools.test.ts\nexport {};",
    ])("does not authorize an undeclared or incomplete file: %s", text => {
        expect(validateAiCodingPluginScopeResponse({text, workspaceFiles}).ok).toBe(false);
    });

    test.each([
        "Also change src/components/editor/AiCodingAgentPanel.jsx.",
        "Also edit /Users/developer/fdo/tests/tools.test.ts.",
        "Also edit /home/developer/fdo/tests/tools.test.ts.",
        "Also edit /private/tmp/fdo/tests/tools.test.ts.",
        "Also edit C:/projects/fdo/tests/tools.test.ts.",
        "Also edit C:\\projects\\fdo\\tests\\tools.test.ts.",
        "### File: /tmp/tests/tools.test.ts\n```typescript\nexport {};\n```",
        "### File: /src/../host.ts\n```typescript\nexport {};\n```",
    ])("new virtual files cannot authorize unrelated host references: %s", extra => {
        expect(validateAiCodingPluginScopeResponse({text: `${newWorkspaceFiles}\n${extra}`, workspaceFiles}).ok)
            .toBe(false);
    });

    test("does not mistake an escaped URL regexp for a Windows path", () => {
        expect(validateAiCodingPluginScopeResponse({
            text: 'const isUrl = /^https?:\\\\/\\\\//.test(value);',
            workspaceFiles,
        })).toMatchObject({ ok: true, references: [] });
    });

    test("allows absolute paths that map cleanly to plugin workspace files", () => {
        expect(validateAiCodingPluginScopeResponse({
            text: [
                "Update the plugin metadata in /Users/alexvwan/dev/fdo/index.ts.",
                "If needed, align the UI label in /Users/alexvwan/dev/fdo/src/render.tsx.",
            ].join("\n"),
            workspaceFiles,
        })).toMatchObject({
            ok: true,
            references: [],
        });
    });

    test("extracts only out-of-scope file references", () => {
        expect(findOutOfScopePluginFileReferences(
            "Use /src/render.tsx plus src/Home.jsx and docs/PLUGIN_CAPABILITY_MODEL.md",
            workspaceFiles,
        )).toEqual(["src/Home.jsx", "docs/PLUGIN_CAPABILITY_MODEL.md"]);
    });

    test("ignores normal javascript property access and built-in method names", () => {
        expect(findOutOfScopePluginFileReferences(
            "Use term.trim(), term.length, Array.from(values.filter(Boolean)), and Array.isArray(value).",
            workspaceFiles,
        )).toEqual([]);
    });

    test("keeps host file detection without overmatching nearby code tokens", () => {
        expect(validateAiCodingPluginScopeResponse({
            text: [
                "File: /src/utils/fdoSdkKnowledge.js",
                "const terms = values.filter(Boolean).map((term) => term.trim());",
                "return Array.from(new Set(terms));",
            ].join("\n"),
            workspaceFiles,
        })).toMatchObject({
            ok: false,
            references: ["/src/utils/fdoSdkKnowledge.js"],
        });
    });

    test("builds a stable user-facing scope message", () => {
        expect(buildAiCodingPluginScopeViolationMessage({
            references: ["src/Home.jsx"],
            phase: "response",
        })).toContain("src/Home.jsx");
    });

    test("does not report absolute workspace-like references as out of scope", () => {
        expect(findOutOfScopePluginFileReferences(
            "Update /Users/alexvwan/dev/fdo/index.ts and /Users/alexvwan/dev/fdo/src/render.tsx for the plugin.",
            workspaceFiles,
        )).toEqual([]);
    });
});
