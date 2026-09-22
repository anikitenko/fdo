const {liveAiRequestLimit, liveAiRequestCeiling, liveAiBudgetPolicy} = require("../../src/utils/liveAiTestPolicy.cjs");
const {codingFirstResponseTimeoutMs} = require("../../src/utils/codingRequestPolicy.cjs");
const {liveThinkingMode} = require('./live-ai-config.cjs');
const {cloudflareAccountId} = require("../../src/utils/cloudflareProvider.cjs");
const {ollamaLlmOptions} = require("../../src/utils/ollamaProvider.cjs");
const path = require("node:path");

function createReliabilityPlan(entries, {repeat = 3, env = process.env, requestLimit} = {}) {
    const requestBudgetMode = requestLimit === undefined ? liveAiBudgetPolicy(env).mode : 'fixed';
    requestLimit ??= liveAiRequestLimit(env);
    const ceiling = liveAiRequestCeiling(env);
    if (!Number.isInteger(repeat) || repeat < 1 || repeat > 10) throw new Error("Repeat must be an integer from 1 to 10.");
    if (!Number.isInteger(requestLimit) || requestLimit < 1 || requestLimit > ceiling) throw new Error(`Request limit must be an integer from 1 to ${ceiling}.`);
    if (!Array.isArray(entries) || !entries.length || entries.length * repeat > 30) throw new Error("Provide a nonempty matrix with at most 30 total runs.");
    return entries.flatMap((entry, index) => {
        const allowed = ["provider", "model", "modelEnv", "apiKeyEnv", "baseUrl", "contextLength", "accountIdEnv", "firstResponseTimeoutMs", "thinkingMode"];
        if (!entry || Object.keys(entry).some(key => !allowed.includes(key))) throw new Error("Matrix entries allow only provider, model or modelEnv, apiKeyEnv, baseUrl, contextLength, accountIdEnv, firstResponseTimeoutMs, and thinkingMode. Keep credentials in environment variables.");
        if (!["openai", "anthropic", "gemini", "ollama", "cloudflare"].includes(entry.provider)) throw new Error("Live matrix supports openai, anthropic, gemini, ollama and cloudflare.");
        if (Boolean(entry.model) === Boolean(entry.modelEnv)) throw new Error("Specify exactly one of model or modelEnv.");
        const accountIdEnv = entry.provider === "cloudflare" ? entry.accountIdEnv || "FDO_TEST_AI_ACCOUNT_ID" : null;
        const apiKeyEnv = entry.provider === "ollama" ? null : entry.apiKeyEnv || "FDO_TEST_AI_API_KEY";
        const local = ollamaLlmOptions({...entry, baseUrl: entry.baseUrl || env.FDO_TEST_AI_BASE_URL, contextLength: entry.contextLength ?? env.FDO_TEST_AI_CONTEXT_LENGTH});
        if (![apiKeyEnv, entry.modelEnv, accountIdEnv].filter(Boolean).every(name => typeof name === "string" && /^[A-Z_][A-Z0-9_]*$/.test(name))) throw new Error("Use valid environment variable names.");
        const model = entry.model || env[entry.modelEnv];
        if (typeof model !== "string" || !model.trim()) throw new Error(`Missing model for matrix entry ${index + 1}.`);
        return Array.from({length: repeat}, (_, repetition) => ({
            id: `${String(index + 1).padStart(2, "0")}-${entry.provider}-run-${repetition + 1}`,
            provider: entry.provider, model: model.trim(), apiKeyEnv, requestLimit, requestBudgetMode,
            defaultThinkingMode: liveThinkingMode(entry.provider, entry.thinkingMode ?? env.FDO_TEST_AI_THINKING_MODE),
            firstResponseTimeoutMs: codingFirstResponseTimeoutMs({provider: entry.provider, firstResponseTimeoutMs: entry.firstResponseTimeoutMs ?? env.FDO_TEST_AI_FIRST_RESPONSE_TIMEOUT_MS}),
            ...(entry.provider === "cloudflare" ? {accountId: cloudflareAccountId(env[accountIdEnv])} : {}),
            ...(entry.provider === "ollama" ? {baseUrl: local.baseUrl, contextLength: local.options.num_ctx} : {}),
        }));
    });
}

function summarizeReliabilityRun(run, {exitCode, signal, report, artifactDir}) {
    const tests = Array.isArray(report?.tests) ? report.tests : [];
    const passed = exitCode === 0 && !signal && report?.status === "passed"
        && report.plannedTests > 0 && tests.length === report.plannedTests
        && tests.every(test => test.status === "passed" && test.expectedStatus === "passed");
    return {id: run.id, provider: run.provider, model: run.model, requestLimit: run.requestLimit, requestBudgetMode: run.requestBudgetMode,
        passed, exitCode, signal: signal || null, durationMs: report?.durationMs ?? null,
        plannedTests: report?.plannedTests ?? null, executedTests: tests.length,
        skippedTests: tests.filter(test => test.status === "skipped").length,
        artifacts: path.resolve(artifactDir)};
}

function summarizeReliability(runs) {
    const groups = new Map();
    for (const run of runs) {
        const key = JSON.stringify([run.provider, run.model]);
        const group = groups.get(key) || {provider: run.provider, model: run.model, runs: 0, passed: 0, durationsMs: []};
        group.runs++;
        if (run.passed) group.passed++;
        if (Number.isFinite(run.durationMs)) group.durationsMs.push(run.durationMs);
        groups.set(key, group);
    }
    return {completedAt: new Date().toISOString(), passed: runs.length > 0 && runs.every(run => run.passed),
        runs, groups: [...groups.values()].map(({durationsMs, ...group}) => {
            const sorted = durationsMs.sort((a, b) => a - b);
            return {...group, passRate: group.passed / group.runs,
                medianDurationMs: sorted.length ? (sorted[Math.floor((sorted.length - 1) / 2)] + sorted[Math.floor(sorted.length / 2)]) / 2 : null,
                maxDurationMs: sorted.length ? sorted[sorted.length - 1] : null};
        })};
}

module.exports = {createReliabilityPlan, summarizeReliabilityRun, summarizeReliability};
