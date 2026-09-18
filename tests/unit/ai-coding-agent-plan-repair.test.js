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
