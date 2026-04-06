import {
    applyWorkspaceMention,
    detectWorkspaceMention,
    getWorkspaceMentionItems,
    getWorkspaceMentionSuggestions,
} from "../../src/components/editor/utils/aiCodingAgentMentions.js";

describe("ai coding agent mentions", () => {
    test("detects an @workspace mention at the current cursor position", () => {
        const text = "please inspect @src/index.ts";
        expect(detectWorkspaceMention(text, text.length)).toEqual({
            query: "src/index.ts",
            start: 15,
            end: text.length,
        });
    });

    test("suggests workspace files by basename and path relevance", () => {
        const suggestions = getWorkspaceMentionSuggestions([
            { path: "/README.md" },
            { path: "/src/index.ts" },
            { path: "/src/index.test.ts" },
            { path: "/docs/indexing.md" },
        ], "ind");

        expect(suggestions).toEqual([
            "src/index.test.ts",
            "src/index.ts",
            "docs/indexing.md",
        ]);
    });

    test("applies the selected mention into the prompt with trailing spacing", () => {
        const mention = {
            query: "rea",
            start: 7,
            end: 11,
        };

        expect(applyWorkspaceMention("review @rea please", mention, "/README.md")).toEqual({
            value: "review @README.md please",
            cursorIndex: 17,
        });
    });

    test("adds synthetic thisFile and file: entries above workspace files", () => {
        const items = getWorkspaceMentionItems(
            [{ path: "/src/index.ts" }, { path: "/README.md" }],
            "fi",
            "/src/index.ts",
        );

        expect(items[0]).toMatchObject({
            type: "special",
            insertText: "@file:",
        });
        expect(items.some((item) => item.insertText === "@thisFile")).toBe(true);
    });
});
