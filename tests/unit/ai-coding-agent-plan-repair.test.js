import {buildExecutablePlanRetryPrompt, buildProblemsRepairPlanPrompt, buildValidationRepairPlanPrompt} from "../../src/components/editor/utils/aiCodingAgentPlanRepair.js";

describe("ai coding agent plan repair prompt", () => {
    test("forces executable workspace file sections after a prose-only plan", () => {
        const prompt = buildExecutablePlanRetryPrompt({
            originalPrompt: "Create a production-grade plugin implementation plan",
            invalidResponse: "Here is a nice overview with bullets and architecture notes.",
        });

        expect(prompt).toContain("IMPORTANT RETRY INSTRUCTION");
        expect(prompt).toContain("did not return executable workspace file sections");
        expect(prompt).toContain("### File: /path/to/file");
        expect(prompt).toContain("Do not return prose");
        expect(prompt).toContain("bullets and architecture notes");
    });
});

test('Problems repair uses the current snapshot and puts repair before the original build request', () => {
    const workspaceFiles = [{path: '/index.ts', content: 'export const hello = "stub";'},
        {path: '/render.tsx', content: 'export const render = () => "current";'}];
    const prompt = buildProblemsRepairPlanPrompt({originalPrompt: 'Create all features', previousResponse: 'stale code',
        problemsContext: '/render.tsx:1:1 [8] Missing export', workspaceFiles});
    expect(prompt).toContain(JSON.stringify(workspaceFiles));
    expect(prompt).not.toContain('stale code');
    expect(prompt.indexOf('IMPORTANT REPAIR')).toBeLessThan(prompt.indexOf('Create all features'));
    expect(prompt).toContain('NOT a request to rebuild');
});

describe("ai coding agent validation repair prompt", () => {
    test("includes concrete validation failures and FDO plugin test constraints", () => {
        const prompt = buildValidationRepairPlanPrompt({
            originalPrompt: "Build a hosts plugin",
            invalidResponse: "### File: /tests/unit/ai-coding-agent-execution-intent.test.js",
            validationErrors: [
                "/tests/unit/ai-coding-agent-execution-intent.test.js:4: plugin code must not import FDO host/editor implementation files",
                "/tests/unit/ai-coding-agent-execution-intent.test.js:6: plugin tests use describe(...) without importing from node:test",
            ],
        });

        expect(prompt).toContain("failed FDO plugin validation");
        expect(prompt).toContain("Validation errors:");
        expect(prompt).toContain("must not import FDO host/editor implementation files");
        expect(prompt).toContain("Plugin tests must use node:test imports and node:assert/strict assertions.");
        expect(prompt).toContain("Do not use Jest/Vitest globals or expect().");
        expect(prompt).toContain("### File: /path/to/file");
    });
});

test("builds a complete-file repair request from Problems panel diagnostics", () => {
    const prompt = buildProblemsRepairPlanPrompt({
        originalPrompt: "Create a JSON Inspector",
        previousResponse: "### File: /render.tsx\n```typescript\nbroken\n```",
        problemsContext: "Current editor problems:\n/render.tsx:14:10 [8] Expected > but found className",
    });
    expect(prompt).toContain("Problems panel now reports errors");
    expect(prompt).toContain("Expected > but found className");
    expect(prompt).toContain("Return ONLY complete executable workspace file sections");
    expect(prompt).toContain("node:assert/strict");
});


test('Problems repairs retain later modules and use focused workspace execution mode', () => {
    const previousResponse = '### File: /styles.css\n```css\n' + '.shell {}\n'.repeat(600)
        + '\n```\n### File: /ui/workspace.ts\n```ts\nexport const workspace = () => "complete view";\n```';
    const prompt = buildProblemsRepairPlanPrompt({originalPrompt: 'Build the workbench', previousResponse,
        problemsContext: '/render.tsx: missing export from /ui/workspace.ts'});
    expect(prompt).toMatch(/^EXECUTION MODE: WORKSPACE TASK IMPLEMENTATION/);
    expect(prompt).toContain(previousResponse);
    expect(prompt).not.toContain('[truncated]');
    expect(prompt).toContain('Return only files that must change');
    expect(prompt).toContain('supersedes older context');
    expect(prompt).toContain('/render.tsx: missing export');
});
