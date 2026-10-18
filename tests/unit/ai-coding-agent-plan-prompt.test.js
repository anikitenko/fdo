import {buildEditCodePrompt, buildFixCodePrompt, buildPlanCodePrompt, buildSmartModePrompt} from "../../src/ipc/ai_coding_agent.js";

describe("ai coding agent prompts", () => {
    test("uses the shared public plugin contract for planning", () => {
        const prompt = buildPlanCodePrompt({
            prompt: "Create a production-grade plugin",
            context: "SDK context",
        });

        expect(prompt).toContain("public plugin contract");
        expect(prompt).toContain("plugin's purpose, user flow, files to change");
        expect(prompt).toContain('A plugin scaffold must include /SKILL.md');
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

    test("staged execution plans defer the response format to each staged request", () => {
        const prompt = buildPlanCodePrompt({
            prompt: "EXECUTION MODE: WORKSPACE TASK IMPLEMENTATION\n\nFix the reported diagnostics.",
            context: "Workspace context",
            executionMode: true,
            staged: true,
        });

        expect(prompt).toContain("The host drives response transport");
        expect(prompt).toContain("never emit \"### File:\" sections or file contents unless the current request explicitly asks for them");
        // The staged plan stage admits only a compact JSON inventory; a
        // file-sections template in the same request contradicts it.
        expect(prompt).not.toContain("### File: /path/to/file");
        expect(prompt).toContain("Use virtual workspace paths only");
        expect(prompt).not.toMatch(/PluginContainer|PluginPage|VirtualFS|ipc\/channels/);
    });

    test("bulk planning receives actual virtual workspace sources instead of depending on disk files", () => {
        const prompt = buildPlanCodePrompt({prompt: 'Extend the plugin', workspaceFiles: [
            {path: '/index.ts', content: 'export const existingFeature = 42;'},
        ]});
        expect(prompt).toContain('export const existingFeature = 42;');
        expect(prompt).toContain('do not look for these files on disk');
    });

    test("bulk repairs receive uncommitted candidate sources and request only corrected file sections", () => {
        const prompt = buildPlanCodePrompt({prompt: 'Fix the compiler error.', staged: false, executionMode: true,
            repairPaths: ['/new.ts'], workspaceFiles: [
                {path: '/new.ts', content: 'export const value: number = "wrong";'},
                {path: '/retained.ts', content: 'export const retained = true;'},
            ]});
        expect(prompt).toContain('including generated files not yet applied');
        expect(prompt).toContain('export const value: number');
        expect(prompt).toContain('export const retained = true;');
        expect(prompt).toContain('Repair only these virtual paths: ["/new.ts"]');
        expect(prompt).toContain('exactly one complete file section');
        expect(prompt).not.toContain('first a compact file inventory');
    });

    test("missing candidate repair source fails before asking the assistant", () => {
        expect(() => buildPlanCodePrompt({repairPaths: ['/absent.ts'], workspaceFiles: []}))
            .toThrow('Repair source is missing');
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

        expect(prompt).toContain("Do not claim you inspected local files, ran commands");
        expect(prompt).toContain("product-host source, settings, credentials");
        expect(prompt).not.toMatch(/PluginManager|PluginContainer|PluginPage|VirtualFS|ipc\/channels/);
    });

    test("workspace reviews request reports rather than executable workspace files", () => {
        const prompt = buildSmartModePrompt({prompt: 'Workspace quality review. Do not modify files.', context: '/index.ts supplied source'});
        expect(prompt).toContain('Return one JSON object');
        expect(prompt).toContain('Do not invoke tools');
        expect(prompt).toContain('never a source file');
        expect(prompt).not.toContain('For implementation requests, return complete workspace file sections');
    });
});

test('smart documentation requests allow configured MCP retrieval and require a non-mutating prose answer', () => {
    const prompt = buildSmartModePrompt({prompt: 'Use the configured OpenAI Docs MCP server to find documentation and explain approvals.'});
    expect(prompt).toContain('Separately configured MCP tools may retrieve external documentation');
    expect(prompt).toContain('return prose and retrieved links; keep the workspace unchanged');
    expect(prompt).toContain('do not emit SOLUTION markers or file replacements');
});

test('investigation mode requests host observations and a report without a source-generation contract',()=>{
    const prompt=buildSmartModePrompt({prompt:'Investigate UI startup',context:'Host typecheck failed.',investigation:true});
    expect(prompt).toContain('PLUGIN INVESTIGATION PROTOCOL');expect(prompt).toContain('Host typecheck failed.');
    expect(prompt).toContain('readFiles');expect(prompt).toContain('remaining token/time budgets');
    expect(prompt).not.toContain('Return complete workspace file sections');
});
