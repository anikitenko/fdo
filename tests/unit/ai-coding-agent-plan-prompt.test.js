import {buildEditCodePrompt, buildFixCodePrompt, buildPlanCodePrompt, buildSmartModePrompt} from "../../src/ipc/ai_coding_agent.js";

describe("ai coding agent plan prompt", () => {
    test("removes outdated plain-html / no-react contradictions from scaffold prompt", () => {
        const prompt = buildPlanCodePrompt({
            prompt: "Create a production-grade FDO plugin",
            context: "SDK context",
            executionMode: false,
        });

        expect(prompt).toContain("React-hosted JSX pipeline");
        expect(prompt).toContain("Plugin render output is not inserted as raw HTML directly");
        expect(prompt).toContain("Do NOT describe FDO plugin UI as “plain HTML strings” as the main abstraction.");
        expect(prompt).not.toContain("FDO plugins do NOT use React");
        expect(prompt).not.toContain("render() method must return plain HTML strings");
        expect(prompt).not.toContain("render() returns HTML string");
    });

    test("keeps iframe-only library scope explicit", () => {
        const prompt = buildPlanCodePrompt({
            prompt: "Create a production-grade FDO plugin",
            context: "SDK context",
            executionMode: false,
        });

        expect(prompt).toContain("The iframe host may preload UI-only libraries such as goober, ace, highlight.js, notyf, FontAwesome, and Split Grid");
        expect(prompt).toContain("available only inside the iframe UI runtime");
    });

    test("forbids package-internal SDK imports and keeps renderOnLoad optional", () => {
        const prompt = buildPlanCodePrompt({
            prompt: "Create a production-grade FDO plugin",
            context: "SDK context",
            executionMode: false,
        });

        expect(prompt).toContain("Use only exported/documented SDK imports");
        expect(prompt).toContain("Do NOT import package-internal paths such as @anikitenko/fdo-sdk/dist/...");
    });

    test("guides plugin tests toward the bundled node:test flow instead of external installs", () => {
        const prompt = buildPlanCodePrompt({
            prompt: "Create a production-grade FDO plugin with tests",
            context: "SDK context",
            executionMode: false,
        });

        expect(prompt).toContain("prefer node:test plus node:assert/strict");
        expect(prompt).toContain("without extra plugin dependencies");
        expect(prompt).toContain("clean machine with only FDO installed");
        expect(prompt).toContain("Do NOT generate Jest/Vitest-style tests with bare describe/it/test globals or expect()");
        expect(prompt).toContain("Do NOT generate tests that import FDO host/editor implementation files");
        expect(prompt).toContain("Do NOT invent host-app structures inside a plugin workspace fix, such as PluginManager, ipc/channels, preload bridges, registry wiring");
        expect(prompt).not.toContain("prefer Jest");
    });

    test("failure-driven prompts stay focused on fixing the current workspace", () => {
        const prompt = buildPlanCodePrompt({
            prompt: "tests are failing please fix",
            context: "Recent test output",
            executionMode: false,
        });

        expect(prompt).toContain("If the user says tests/build/problems are failing, fix the current workspace first");
        expect(prompt).not.toContain("scaffold a new plugin");
    });

    test("forbids sandbox or writable-workspace excuses in plan responses", () => {
        const prompt = buildPlanCodePrompt({
            prompt: "Fix the failing plugin tests",
            context: "Recent test output",
            executionMode: false,
        });

        expect(prompt).toContain("Do NOT say that the workspace is read-only");
        expect(prompt).toContain("or that the user must provide a writable workspace");
    });

    test("execution prompt stays focused on workspace file sections", () => {
        const prompt = buildPlanCodePrompt({
            prompt: "EXECUTION MODE: WORKSPACE TASK IMPLEMENTATION\nImplement current TODO",
            context: "Workspace context",
            executionMode: true,
        });

        expect(prompt).toContain("Return ONLY executable file sections");
        expect(prompt).not.toContain("React-hosted JSX pipeline");
    });

    test("fix prompt pins SEARCH/REPLACE blocks to the known virtual workspace target file", () => {
        const prompt = buildFixCodePrompt({
            error: "Tests are failing",
            language: "ts",
            code: "describe('x', () => {});",
            context: "Recent test output",
            targetFilePath: "/tests/unit/example.test.ts",
        });

        expect(prompt).toContain("Target workspace file: /tests/unit/example.test.ts");
        expect(prompt).toContain("Every File: header must be exactly /tests/unit/example.test.ts");
        expect(prompt).toContain("never host-machine absolute paths such as /Users/... or /tmp/...");
        expect(prompt).not.toContain("<-- leave one empty line here -->");
    });

    test("edit prompt pins SEARCH/REPLACE blocks to the known virtual workspace target file", () => {
        const prompt = buildEditCodePrompt({
            instruction: "Fix the failing test",
            language: "ts",
            code: "describe('x', () => {});",
            context: "Recent test output",
            targetFilePath: "/tests/unit/example.test.ts",
        });

        expect(prompt).toContain("Target workspace file: /tests/unit/example.test.ts");
        expect(prompt).toContain("Every File: header must be exactly /tests/unit/example.test.ts");
        expect(prompt).toContain("never host-machine absolute paths such as /Users/... or /tmp/...");
        expect(prompt).not.toContain("<-- leave one empty line here -->");
    });

    test("smart mode forbids sandbox excuses and invented repo-level command runs", () => {
        const prompt = buildSmartModePrompt({
            prompt: "please run tests and fix errors if any exist",
            code: "",
            language: "ts",
            context: "Recent test output:\n[ERROR] /tests/unit/example.test.ts: describe is not defined",
        });

        expect(prompt).toContain("Do NOT say that the workspace is read-only");
        expect(prompt).toContain("Do NOT claim you ran repo-level commands such as npm test");
        expect(prompt).toContain("do NOT invent host-app structures such as PluginManager, ipc/channels, preload bridges, registry wiring");
        expect(prompt).not.toContain("<-- leave one empty line here -->");
    });
});
