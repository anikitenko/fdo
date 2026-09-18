let requests = 0;

export function reserveLiveAiTestRequest(env = process.env) {
    if (env.FDO_E2E !== "1" || env.FDO_E2E_LIVE_AI !== "1") return;
    const limit = Number(env.FDO_TEST_AI_MAX_REQUESTS || 12);
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new Error("Live AI request limit must be an integer from 1 to 50.");
    if (requests >= limit) throw new Error(`Live AI request limit reached (${limit}). No further requests were sent.`);
    requests += 1;
}
