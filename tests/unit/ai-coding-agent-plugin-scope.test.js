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

    test("detects host-app references in the response", () => {
        expect(validateAiCodingPluginScopeResponse({
            text: "Change src/Home.jsx and /Users/alexvwan/dev/fdo/src/components/SideBar.jsx",
            workspaceFiles,
        })).toMatchObject({
            ok: false,
        });
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
