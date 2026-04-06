import {buildAiCodingBuildOutputContext} from "../../src/components/editor/utils/aiCodingAgentBuildOutput.js";

describe("ai coding agent build output context", () => {
    test("prefers recent failing test/build output for AI context", () => {
        const context = buildAiCodingBuildOutputContext({
            testHistory: [
                {error: false, message: "Preparing plugin test workspace...", ts: 1710000000000},
                {error: true, message: "AssertionError: expected true to equal false", ts: 1710000001000},
                {error: true, message: "at /index.test.ts:14:3", ts: 1710000002000},
            ],
        });

        expect(context).toContain("Recent test output:");
        expect(context).toContain("[2024-03-09T16:00:01.000Z] [ERROR] AssertionError: expected true to equal false");
        expect(context).toContain("/index.test.ts:14:3");
        expect(context).not.toContain("Preparing plugin test workspace...");
    });

    test("normalizes host absolute paths in output back to workspace paths when possible", () => {
        const context = buildAiCodingBuildOutputContext({
            testHistory: [
                {
                    error: true,
                    message: "/Users/alexvwan/dev/fdo/tests/unit/validate-generated-plugin-files.test.js:3: ReferenceError: describe is not defined",
                    ts: 1710000001000,
                },
            ],
            workspaceFiles: [
                {
                    path: "/tests/unit/validate-generated-plugin-files.test.js",
                    content: "",
                },
            ],
        });

        expect(context).toContain("/tests/unit/validate-generated-plugin-files.test.js:3: ReferenceError: describe is not defined");
        expect(context).not.toContain("/Users/alexvwan/dev/fdo/tests/unit/validate-generated-plugin-files.test.js");
    });

    test("falls back to recent informational output when no failures exist", () => {
        const context = buildAiCodingBuildOutputContext({
            buildHistory: [
                {error: false, message: "Building plugin...", ts: 1710000000000},
                {error: false, message: "Compilation successful!", ts: 1710000001000},
            ],
            testHistory: [
                {error: false, message: "Running plugin tests with bundled Node test runner...", ts: 1710000002000},
                {error: false, message: "Plugin tests passed.", ts: 1710000003000},
            ],
        });

        expect(context).toContain("Recent build output:");
        expect(context).toContain("Recent test output:");
        expect(context).toContain("[INFO] Building plugin...");
        expect(context).toContain("[INFO] Running plugin tests with bundled Node test runner...");
        expect(context).toContain("[INFO] Plugin tests passed.");
    });
});
