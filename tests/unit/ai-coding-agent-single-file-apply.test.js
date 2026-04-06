import {
    applyAiMetadataBlockResponse,
    decideAiSingleFileApplyStrategy,
    extractAiCodeToApply,
} from "../../src/components/editor/utils/aiCodingAgentSingleFileApply.js";

describe("ai coding agent single-file apply", () => {
    test("extracts SOLUTION-marked code blocks first", () => {
        const result = extractAiCodeToApply(`
before
\`\`\`ts

// SOLUTION READY TO APPLY
const value = 1;
\`\`\`
after
        `);

        expect(result.code).toBe("const value = 1;");
        expect(result.source).toBe("solution-block");
    });

    test("uses selection replacement for partial fixes with a selection", () => {
        const result = decideAiSingleFileApplyStrategy({
            content: "```ts\nconst value = fixedValue();\n```",
            currentFileText: "function a() {}\nfunction b() {}\n",
            selectedText: "function b() {}\n",
            hasSelection: true,
        });

        expect(result.safe).toBe(true);
        expect(result.mode).toBe("replace-selection");
    });

    test("refuses unsafe partial fixes when there is no selection", () => {
        const result = decideAiSingleFileApplyStrategy({
            content: "```ts\nconst value = fixedValue();\n```",
            currentFileText: "function a() {}\nfunction b() {}\n",
            selectedText: "",
            hasSelection: false,
        });

        expect(result.safe).toBe(false);
        expect(result.mode).toBe("unsafe-no-selection");
    });

    test("allows full-file replacement with no selection when response looks like a full file", () => {
        const result = decideAiSingleFileApplyStrategy({
            content: "```ts\nimport x from 'y';\nexport default function App() { return null; }\n```",
            currentFileText: "const old = true;",
            selectedText: "",
            hasSelection: false,
        });

        expect(result.safe).toBe(true);
        expect(result.mode).toBe("replace-whole-file");
    });

    test("treats short near-complete rewrites as whole-file replacements", () => {
        const result = decideAiSingleFileApplyStrategy({
            content: [
                "```ts",
                'private readonly _metadata: PluginMetadata = {',
                '  name: "Test6 Plugin",',
                '  version: "1.0.0",',
                "};",
                "```",
            ].join("\n"),
            currentFileText: [
                'private readonly _metadata: PluginMetadata = {',
                '  name: "undefined",',
                '  version: "1.0.0",',
                "};",
            ].join("\n"),
            selectedText: "",
            hasSelection: false,
        });

        expect(result.safe).toBe(true);
        expect(result.mode).toBe("replace-whole-file");
    });

    test("refuses small snippet replacement for large selected code in fix mode", () => {
        const result = decideAiSingleFileApplyStrategy({
            action: "fix",
            content: "```ts\nconst safeValue = fallback();\n```",
            currentFileText: "function bigFile() {}\n",
            selectedText: [
                "function renderPanel() {",
                "  const brokenValue = oldThing();",
                "  const secondValue = anotherThing();",
                "  return brokenValue + secondValue;",
                "}",
            ].join("\n"),
            hasSelection: true,
        });

        expect(result.safe).toBe(false);
        expect(result.mode).toBe("unsafe-partial-selection");
    });

    test("refuses prose-only full responses even when they are long", () => {
        const result = decideAiSingleFileApplyStrategy({
            content: [
                "I couldn’t make the rename yet because the provided workspace context does not include the plugin’s own source file or metadata file.",
                "",
                "What I found:",
                "- The repo context contains host app files, tests, and SDK docs/examples.",
            ].join("\n"),
            currentFileText: 'export default class Test6 {\\n  public metadata = { name: "undefined" };\\n}\\n',
            selectedText: "",
            hasSelection: false,
        });

        expect(result.safe).toBe(false);
        expect(result.mode).toBe("unsafe-no-selection");
    });

    test("applies metadata getter replacement blocks to an existing plugin file", () => {
        const patched = applyAiMetadataBlockResponse({
            responseContent: [
                "Change metadata.name in /index.ts from \"undefined\" to a real display name.",
                "",
                "// SOLUTION READY TO APPLY",
                "public get metadata(): PluginMetadata {",
                "    return {",
                "        name: \"Test6 Sample Plugin\",",
                "        version: \"1.0.0\",",
                "        author: \"AleXvWaN\",",
                "        description: \"A sample FDO plugin\",",
                "        icon: \"cog\",",
                "    };",
                "}",
            ].join("\n"),
            targetSource: [
                "export default class Test6 extends FDO_SDK {",
                "    public get metadata(): PluginMetadata {",
                "        return {",
                "            name: \"undefined\",",
                "            version: \"1.0.0\",",
                "            author: \"AleXvWaN\",",
                "            description: \"A sample FDO plugin\",",
                "            icon: \"cog\",",
                "        };",
                "    }",
                "}",
            ].join("\n"),
        });

        expect(patched).toContain('name: "Test6 Sample Plugin"');
        expect(patched).not.toContain('name: "undefined"');
    });
});
