import {
    applyAiSearchReplaceBlocks,
    parseAiSearchReplaceBlocks,
    parseAiSearchReplaceResponse,
    shouldApplyAiSearchReplace,
} from "../../src/components/editor/utils/aiCodingAgentSearchReplace.js";

describe("ai coding agent search replace", () => {
    test("parses SEARCH/REPLACE blocks from a markdown patch response", () => {
        const response = `
\`\`\`patch
File: /src/index.ts
<<<<<<< SEARCH
const oldValue = 1;
=======
const newValue = 2;
>>>>>>> REPLACE
\`\`\`
        `;

        expect(parseAiSearchReplaceBlocks(response)).toEqual([
            {
                filePath: "/src/index.ts",
                search: "const oldValue = 1;",
                replace: "const newValue = 2;",
            },
        ]);
        expect(shouldApplyAiSearchReplace(response)).toBe(true);
    });

    test("parses blocks without an explicit file path for backward compatibility", () => {
        const response = `
\`\`\`patch
<<<<<<< SEARCH
const oldValue = 1;
=======
const newValue = 2;
>>>>>>> REPLACE
\`\`\`
        `;

        expect(parseAiSearchReplaceBlocks(response)).toEqual([
            {
                filePath: "",
                search: "const oldValue = 1;",
                replace: "const newValue = 2;",
            },
        ]);
    });

    test("rejects host-machine absolute file paths and reports them as invalid", () => {
        const response = `
\`\`\`patch
File: /Users/alexvwan/dev/fdo/tests/unit/example.test.js
<<<<<<< SEARCH
const oldValue = 1;
=======
const newValue = 2;
>>>>>>> REPLACE
\`\`\`
        `;

        expect(parseAiSearchReplaceResponse(response)).toEqual({
            blocks: [],
            invalidPaths: ["/Users/alexvwan/dev/fdo/tests/unit/example.test.js"],
        });
        expect(parseAiSearchReplaceBlocks(response)).toEqual([]);
        expect(shouldApplyAiSearchReplace(response)).toBe(true);
    });

    test("applies a single SEARCH/REPLACE block", () => {
        const source = "const oldValue = 1;\nconsole.log(oldValue);\n";
        const next = applyAiSearchReplaceBlocks(source, [
            {
                search: "const oldValue = 1;",
                replace: "const newValue = 2;",
            },
        ]);

        expect(next).toBe("const newValue = 2;\nconsole.log(oldValue);\n");
    });

    test("applies multiple SEARCH/REPLACE blocks sequentially", () => {
        const source = "const a = 1;\nconst b = 2;\n";
        const next = applyAiSearchReplaceBlocks(source, [
            {
                search: "const a = 1;",
                replace: "const a = 10;",
            },
            {
                search: "const b = 2;",
                replace: "const b = 20;",
            },
        ]);

        expect(next).toBe("const a = 10;\nconst b = 20;\n");
    });

    test("throws when SEARCH block does not match the target text", () => {
        expect(() => applyAiSearchReplaceBlocks("const a = 1;", [
            {
                search: "const missing = 1;",
                replace: "const a = 2;",
            },
        ])).toThrow("SEARCH block 1 did not match the target code.");
    });
});
