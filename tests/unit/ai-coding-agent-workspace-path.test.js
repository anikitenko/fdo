import {
    isSafeVirtualWorkspacePath,
    sanitizeVirtualWorkspacePath,
} from "../../src/components/editor/utils/aiCodingAgentWorkspacePath.js";

describe("ai coding agent workspace path safety", () => {
    test("accepts normal virtual workspace paths", () => {
        expect(isSafeVirtualWorkspacePath("/TODO.md")).toBe(true);
        expect(isSafeVirtualWorkspacePath("/src/index.ts")).toBe(true);
        expect(sanitizeVirtualWorkspacePath("/src/index.ts")).toBe("/src/index.ts");
    });

    test("rejects host-machine absolute paths", () => {
        expect(isSafeVirtualWorkspacePath("/Users/alexvwan/dev/fdo/src/file.ts")).toBe(false);
        expect(isSafeVirtualWorkspacePath("/tmp/test.txt")).toBe(false);
        expect(isSafeVirtualWorkspacePath("/var/log/test.log")).toBe(false);
        expect(sanitizeVirtualWorkspacePath("/Users/alexvwan/dev/fdo/src/file.ts")).toBeNull();
    });

    test("rejects traversal and windows-style paths", () => {
        expect(isSafeVirtualWorkspacePath("/src/../secret.txt")).toBe(false);
        expect(isSafeVirtualWorkspacePath("/C:/Users/test/file.ts")).toBe(false);
        expect(isSafeVirtualWorkspacePath("/src\\evil.ts")).toBe(false);
    });
});
