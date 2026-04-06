import {
    buildAiCodingFollowUpDraft,
    buildAiCodingFollowUpPrompt,
    shouldTreatAsAiCodingFollowUp,
} from "../../src/components/editor/utils/aiCodingAgentFollowup.js";

describe("ai coding agent follow-up detection", () => {
    test("treats explicit refinement as follow-up", () => {
        expect(shouldTreatAsAiCodingFollowUp({
            prompt: "Please make it production grade",
            previousResponse: "Initial answer",
            forceFollowUp: true,
        })).toBe(true);
    });

    test("treats short continuation prompts as follow-ups when a previous response exists", () => {
        expect(shouldTreatAsAiCodingFollowUp({
            prompt: "okay.. so please create TODO and let's do that!",
            previousResponse: "Build a hosts manager with rollback and profiles.",
            forceFollowUp: false,
        })).toBe(true);
    });

    test("does not treat unrelated new asks as follow-ups", () => {
        expect(shouldTreatAsAiCodingFollowUp({
            prompt: "Explain this React hook bug in detail",
            previousResponse: "Build a hosts manager with rollback and profiles.",
            forceFollowUp: false,
        })).toBe(false);
    });

    test("builds an explicit continuation request for short follow-ups", () => {
        const prompt = buildAiCodingFollowUpPrompt({
            prompt: "okay.. so please create TODO and let's do that!",
            previousResponse: "Build a hosts manager with rollback and profiles.",
            forceFollowUp: false,
        });

        expect(prompt).toContain("Continue the previously suggested plugin-local next step.");
        expect(prompt).toContain("Previously suggested next step:");
        expect(prompt).toContain("User confirmed:");
        expect(prompt).toContain("rollback and profiles");
    });

    test("turns affirmative continuation prompts into an explicit next-step request", () => {
        const prompt = buildAiCodingFollowUpPrompt({
            prompt: "oh, cool, please do",
            previousResponse: [
                'Update /index.ts so metadata.name becomes "Test 6 Demo Plugin".',
                "",
                "If you want, I can also align the UI heading in /render.tsx so it shows the same plugin name.",
            ].join("\n"),
            forceFollowUp: false,
        });

        expect(prompt).toContain("Continue the previously suggested plugin-local next step.");
        expect(prompt).toContain("Relevant plugin files: /index.ts, /render.tsx.");
        expect(prompt).toContain("Previously suggested next step: align the UI heading in /render.tsx so it shows the same plugin name");
        expect(prompt).toContain("User confirmed: oh, cool, please do");
        expect(prompt).not.toContain("Previous AI response:");
    });

    test("constrains targeted refine follow-ups to existing plugin files", () => {
        const prompt = buildAiCodingFollowUpPrompt({
            prompt: "and can you please also change name in render?",
            previousResponse: [
                'Update /index.ts so metadata.name becomes "Test 6 Demo Plugin".',
                "",
                "If you want, I can also align the UI heading in /render.tsx so it shows the same plugin name.",
            ].join("\n"),
            forceFollowUp: true,
        });

        expect(prompt).toContain("Continue this existing plugin-local thread.");
        expect(prompt).toContain("Update existing plugin files only.");
        expect(prompt).toContain("Do not scaffold a new plugin");
        expect(prompt).toContain("Relevant plugin files: /index.ts, /render.tsx.");
        expect(prompt).toContain("Follow-up request: and can you please also change name in render?");
        expect(prompt).not.toContain("File Structure");
    });

    test("builds a refine draft from the previous plugin-local next step", () => {
        const draft = buildAiCodingFollowUpDraft([
            'Update /index.ts so metadata.name becomes "Test 6 Demo Plugin".',
            "",
            "If you want, I can also align the UI heading in /render.tsx so it shows the same plugin name.",
        ].join("\n"));

        expect(draft).toBe("Please continue with this plugin-local next step: align the UI heading in /render.tsx so it shows the same plugin name.");
    });

    test("ignores code fences when building a refine draft", () => {
        const draft = buildAiCodingFollowUpDraft([
            "If you want, I can also update the render heading in /render.tsx.",
            "",
            "```typescript",
            "export default function Render() {",
            "  return <h1>Creative Plugin</h1>;",
            "}",
            "```",
        ].join("\n"));

        expect(draft).toBe("Please continue with this plugin-local next step: update the render heading in /render.tsx.");
        expect(draft).not.toContain("```typescript");
    });
});
