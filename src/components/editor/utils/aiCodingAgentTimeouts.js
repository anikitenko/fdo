export function getAiCodingAgentIdleTimeoutMs(provider = "") {
    return (provider === "codex-cli" || provider === "gemini-cli") ? 180000 : 60000;
}
