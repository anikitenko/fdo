const {liveAiRequestLimit, liveAiBudgetPolicy} = require("../../src/utils/liveAiTestPolicy.cjs");
const {inspectGeminiModel} = require("../../src/utils/geminiProvider.cjs");
const {codingFirstResponseTimeoutMs} = require("../../src/utils/codingRequestPolicy.cjs");
const {cloudflareAccountId, inspectCloudflareModel} = require("../../src/utils/cloudflareProvider.cjs");
const {ollamaLlmOptions, inspectOllamaModel} = require("../../src/utils/ollamaProvider.cjs");

function liveThinkingMode(provider, value) {
    // Live coding scenarios need completed source files. Qwen's optional
    // reasoning can otherwise consume the entire upstream stream lifetime.
    const mode = value || (provider === 'cloudflare' ? 'off' : 'auto');
    if (!['auto', 'on', 'off'].includes(mode)) throw new Error('FDO_TEST_AI_THINKING_MODE must be auto, on or off.');
    return mode;
}

function findLiveCodingAssistant(assistants, config, name) {
    return Array.isArray(assistants) ? assistants.find(assistant => assistant.purpose === 'coding'
        && assistant.name === name && assistant.provider === config.provider && assistant.model === config.model
        && assistant.defaultThinkingMode === config.defaultThinkingMode
        && assistant.firstResponseTimeoutMs === config.firstResponseTimeoutMs
        && (config.provider !== 'cloudflare' || assistant.accountId === config.accountId)
        && (config.provider !== 'ollama' || (assistant.baseUrl === config.baseUrl && assistant.contextLength === config.contextLength))) : undefined;
}

function readLiveAiConfig(env = process.env) {
    const provider = env.FDO_TEST_AI_PROVIDER || "openai";
    const model = String(env.FDO_TEST_AI_MODEL || "").trim();
    const defaultThinkingMode = liveThinkingMode(provider, env.FDO_TEST_AI_THINKING_MODE);
    const apiKey = provider === "ollama" ? "" : String(env.FDO_TEST_AI_API_KEY || "").trim();
    const limit = liveAiRequestLimit(env);
    if (!["openai", "anthropic", "gemini", "ollama", "cloudflare"].includes(provider) || !model || (provider !== "ollama" && !apiKey)) {
        throw new Error("Set FDO_TEST_AI_MODEL and FDO_TEST_AI_PROVIDER=openai|anthropic|gemini|ollama|cloudflare. Hosted providers also require FDO_TEST_AI_API_KEY. No personal credential fallback.");
    }
    const local = ollamaLlmOptions({provider, baseUrl: env.FDO_TEST_AI_BASE_URL, contextLength: env.FDO_TEST_AI_CONTEXT_LENGTH});
    return {provider, model, apiKey, limit, requestBudgetMode: liveAiBudgetPolicy(env).mode, defaultThinkingMode, firstResponseTimeoutMs: codingFirstResponseTimeoutMs({provider, firstResponseTimeoutMs: env.FDO_TEST_AI_FIRST_RESPONSE_TIMEOUT_MS}), ...(provider === "cloudflare" ? {accountId: cloudflareAccountId(env.FDO_TEST_AI_ACCOUNT_ID)} : {}), ...(provider === "ollama" ? {
        baseUrl: local.baseUrl, contextLength: local.options.num_ctx,
    } : {})};
}

async function preflightLiveAi(config, grep = "", options = {}) {
    const requireVision = !grep || /Web Tools|Workbench|Rose Calculator|image|reference|mockup/i.test(grep);
    if (config.provider === "gemini") return inspectGeminiModel(config, options);
    if (config.provider === "cloudflare") return inspectCloudflareModel(config, {...options, requireVision});
    if (config.provider !== "ollama") return;
    await inspectOllamaModel(config.baseUrl, config.model, {...options, requireVision});
}

module.exports = {readLiveAiConfig, preflightLiveAi, liveThinkingMode, findLiveCodingAssistant};
