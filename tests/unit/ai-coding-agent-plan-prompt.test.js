import {buildEditCodePrompt, buildFixCodePrompt, buildPlanCodePrompt, buildSmartModePrompt} from "../../src/ipc/ai_coding_agent.js";

describe("ai coding agent prompts", () => {
    test("uses the shared public plugin contract for planning", () => {
        const prompt = buildPlanCodePrompt({
            prompt: "Create a production-grade plugin",
            context: "SDK context",
        });

        expect(prompt).toContain("public plugin contract");
        expect(prompt).toContain("plugin's purpose, user flow, files to change");
        expect(prompt).not.toMatch(/PluginContainer|PluginPage|VirtualFS|ipc\/channels/);
    });

    test("keeps execution responses limited to workspace file sections", () => {
        const prompt = buildPlanCodePrompt({
            prompt: "Implement current TODO",
            context: "Workspace context",
            executionMode: true,
        });

        expect(prompt).toContain("Return only complete executable workspace file sections");
        expect(prompt).toContain("### File: /path/to/file");
        expect(prompt).toContain("Use virtual workspace paths only");
        expect(prompt).not.toMatch(/PluginContainer|PluginPage|VirtualFS|ipc\/channels/);
    });

    test("pins SEARCH/REPLACE blocks to the known virtual workspace target", () => {
        for (const buildPrompt of [buildFixCodePrompt, buildEditCodePrompt]) {
            const prompt = buildPrompt({
                error: "Tests are failing",
                instruction: "Fix the failing test",
                language: "ts",
                code: "describe('x', () => {});",
                context: "Recent test output",
                targetFilePath: "/tests/unit/example.test.ts",
            });
            expect(prompt).toContain("Target workspace file: /tests/unit/example.test.ts");
            expect(prompt).toContain("Every File: header must be exactly /tests/unit/example.test.ts");
            expect(prompt).toContain("never host-machine absolute paths such as /Users/... or /tmp/...");
        }
    });

    test("keeps smart mode inside public plugin context", () => {
        const prompt = buildSmartModePrompt({
            prompt: "please run tests and fix errors if any exist",
            context: "Recent test output",
        });

        expect(prompt).toContain("Do not claim you inspected files, ran commands");
        expect(prompt).toContain("product-host source, settings, credentials");
        expect(prompt).not.toMatch(/PluginManager|PluginContainer|PluginPage|VirtualFS|ipc\/channels/);
    });
});
