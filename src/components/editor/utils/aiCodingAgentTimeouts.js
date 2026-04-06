export function getAiCodingAgentIdleTimeoutMs(provider = "") {
    return provider === "codex-cli" ? 180000 : 60000;
}
