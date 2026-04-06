import {buildSingleFileApplyRetryPrompt} from "../../src/components/editor/utils/aiCodingAgentSingleFileRepair.js";

describe("ai coding agent single-file repair prompt", () => {
    test("builds a stricter retry prompt for partial fix responses", () => {
        const prompt = buildSingleFileApplyRetryPrompt({
            originalPrompt: "please fix current problems in code",
            invalidResponse: "const safeValue = fallback();",
            action: "fix",
        });

        expect(prompt).toContain("too partial to apply safely");
        expect(prompt).toContain("SEARCH/REPLACE");
        expect(prompt).toContain("Do NOT return general recommendations");
    });

    test("requests a full file rewrite when no selection is available", () => {
        const prompt = buildSingleFileApplyRetryPrompt({
            originalPrompt: "can you please make name of plugin from undefined to a better name?",
            invalidResponse: 'name: "Better Plugin"',
            action: "generate",
            currentFilePath: "/index.ts",
            hasSelection: false,
        });

        expect(prompt).toContain("target file");
        expect(prompt).toContain("full rewrite of the entire target file");
        expect(prompt).not.toContain("selected code region");
    });
});
