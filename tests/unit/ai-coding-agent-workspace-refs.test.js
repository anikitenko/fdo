import {
    extractWorkspaceFileReferences,
    formatWorkspaceReferenceContext,
    resolveWorkspaceFileReferences,
} from "../../src/components/editor/utils/aiCodingAgentWorkspaceRefs.js";

describe("ai coding agent workspace file references", () => {
    const files = [
        { path: "/TODO.md", content: "- [ ] item" },
        { path: "/README.md", content: "# Readme" },
        { path: "/src/index.ts", content: "export {};" },
    ];

    test("extracts explicit and implicit file references from prompt text", () => {
        expect(extractWorkspaceFileReferences("can you send me your TODO.md and readme?"))
            .toEqual(["TODO.md", "README.md"]);
    });

    test("extracts @-prefixed workspace file references", () => {
        expect(extractWorkspaceFileReferences("please review @src/index.ts and @README.md"))
            .toEqual(["src/index.ts", "README.md"]);
    });

    test("prefers actual workspace files for implicit aliases like todo", () => {
        expect(extractWorkspaceFileReferences(
            "continue with todo after testing",
            [{ path: "/IMPLEMENTATION-TODO.md", content: "- [ ] item" }],
        )).toEqual(["IMPLEMENTATION-TODO.md"]);
    });

    test("resolves referenced files from the virtual workspace", () => {
        const resolved = resolveWorkspaceFileReferences(files, ["TODO.md"]);
        expect(resolved).toEqual([{ path: "/TODO.md", content: "- [ ] item" }]);
    });

    test("formats referenced workspace files into context", () => {
        const context = formatWorkspaceReferenceContext([{ path: "/TODO.md", content: "- [ ] item" }]);
        expect(context).toContain("Referenced workspace files");
        expect(context).toContain("/TODO.md");
        expect(context).toContain("- [ ] item");
    });
});
