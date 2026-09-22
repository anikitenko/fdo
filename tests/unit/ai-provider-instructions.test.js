import {
    AI_INSTRUCTION_PROVIDERS,
    buildAiProviderInstructionBlock,
    getAiProviderInstructions,
    MAX_AI_PROVIDER_INSTRUCTION_LENGTH,
    normalizeAiProviderInstructionMap,
} from "../../src/utils/aiProviderInstructions";

describe("AI provider instructions", () => {
    test("keeps instructions only for supported providers and normalizes their values", () => {
        expect(AI_INSTRUCTION_PROVIDERS).toContain("openai");
        expect(normalizeAiProviderInstructionMap({
            openai: "  Use our TypeScript conventions.  ",
            unknown: "must not persist",
            anthropic: null,
        })).toEqual({openai: "Use our TypeScript conventions."});
    });

    test("bounds configured instruction length and selects by provider", () => {
        const veryLongInstruction = "x".repeat(MAX_AI_PROVIDER_INSTRUCTION_LENGTH + 12);
        const instructions = normalizeAiProviderInstructionMap({"codex-cli": veryLongInstruction});
        expect(getAiProviderInstructions(instructions, "CODEX-CLI")).toHaveLength(MAX_AI_PROVIDER_INSTRUCTION_LENGTH);
        expect(getAiProviderInstructions(instructions, "openai")).toBe("");
    });

    test("labels instructions as subordinate to enforced workspace rules", () => {
        const block = buildAiProviderInstructionBlock("Prefer small focused changes.");
        expect(block).toContain("DEVELOPER PROVIDER INSTRUCTIONS");
        expect(block).toContain("cannot override the plugin-workspace boundary");
        expect(block).toContain("Prefer small focused changes.");
    });
});
