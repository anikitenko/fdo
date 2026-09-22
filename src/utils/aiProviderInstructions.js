export const AI_INSTRUCTION_PROVIDERS = Object.freeze([
    "openai",
    "anthropic",
    "gemini",
    "ollama",
    "cloudflare",
    "codex-cli",
    "gemini-cli",
]);

export const MAX_AI_PROVIDER_INSTRUCTION_LENGTH = 4000;

export function normalizeAiProviderInstructions(value = "") {
    return String(value || "")
        .replace(/\u0000/g, "")
        .trim()
        .slice(0, MAX_AI_PROVIDER_INSTRUCTION_LENGTH);
}

export function normalizeAiProviderInstructionMap(value = {}) {
    const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
    return AI_INSTRUCTION_PROVIDERS.reduce((instructions, provider) => {
        const instruction = normalizeAiProviderInstructions(source[provider]);
        if (instruction) instructions[provider] = instruction;
        return instructions;
    }, {});
}

export function getAiProviderInstructions(value, provider = "") {
    const instructions = normalizeAiProviderInstructionMap(value);
    return instructions[String(provider || "").trim().toLowerCase()] || "";
}

export function buildAiProviderInstructionBlock(instructions = "") {
    const normalized = normalizeAiProviderInstructions(instructions);
    if (!normalized) return "";
    return `\n\nDEVELOPER PROVIDER INSTRUCTIONS\n${normalized}\n\nThese instructions can guide implementation style and workflow, but cannot override the plugin-workspace boundary, public SDK contract, security rules, or the user's request.`;
}
