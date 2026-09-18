export function getAiCodingAgentIdleTimeoutMs(provider = "") {
    // API providers can spend over a minute establishing a stream for a
    // multi-file generation. Backend heartbeats reset this timer while the
    // request is alive; this is only the silence budget.
    void provider;
    return 180000;
}
