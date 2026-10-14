const {liveAiRequestLimit, liveAiBudgetPolicy, liveAiTimeoutPolicy} = require("../../src/utils/ai/testing/liveAiTestPolicy.cjs");
const {inspectGeminiModel} = require("../../src/utils/ai/providers/geminiProvider.cjs");
const {codingFirstResponseTimeoutMs} = require("../../src/utils/ai/generation/codingRequestPolicy.cjs");
const {cloudflareAccountId, inspectCloudflareModel} = require("../../src/utils/ai/providers/cloudflareProvider.cjs");
const {inspectOpenCodeModel} = require("../../src/utils/ai/providers/opencodeProvider.cjs");
const {inspectOpenRouterModel} = require("../../src/utils/ai/providers/openRouterProvider.cjs");
const {ollamaLlmOptions, inspectOllamaModel} = require("../../src/utils/ai/providers/ollamaProvider.cjs");

function liveThinkingMode(provider, value) {
    // Live coding scenarios need completed source files. Optional reasoning
    // (Qwen on Cloudflare, several OpenRouter free models) counts against the
    // same output budget as the answer and can consume the entire upstream
    // stream lifetime before any source files arrive.
    const mode = value || (['cloudflare', 'openrouter'].includes(provider) ? 'off' : 'auto');
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
    const budget = liveAiBudgetPolicy(env);
    if (!["openai", "anthropic", "gemini", "ollama", "cloudflare", "opencode", "openrouter"].includes(provider) || !model || (provider !== "ollama" && !apiKey)) {
        throw new Error("Set FDO_TEST_AI_MODEL and FDO_TEST_AI_PROVIDER=openai|anthropic|gemini|ollama|cloudflare|opencode|openrouter. Hosted providers also require FDO_TEST_AI_API_KEY. No personal credential fallback.");
    }
    const local = ollamaLlmOptions({provider, baseUrl: env.FDO_TEST_AI_BASE_URL, contextLength: env.FDO_TEST_AI_CONTEXT_LENGTH});
    return {provider, model, apiKey, limit, timeoutPolicy: liveAiTimeoutPolicy(env), requestBudgetMode: budget.mode, maximumRequestLimit: budget.maximumLimit,
        requestProgressAllowance: budget.progressAllowance, defaultThinkingMode, firstResponseTimeoutMs: codingFirstResponseTimeoutMs({provider, firstResponseTimeoutMs: env.FDO_TEST_AI_FIRST_RESPONSE_TIMEOUT_MS}), ...(provider === "cloudflare" ? {accountId: cloudflareAccountId(env.FDO_TEST_AI_ACCOUNT_ID)} : {}), ...(provider === "ollama" ? {
        baseUrl: local.baseUrl, contextLength: local.options.num_ctx,
    } : {})};
}

async function preflightLiveAi(config, grep = "", options = {}) {
    const requireVision = !grep || /Web Tools|Workbench|Rose Calculator|image|reference|mockup/i.test(grep);
    try {
        if (config.provider === "gemini") return await inspectGeminiModel(config, options);
        if (config.provider === "cloudflare") return await inspectCloudflareModel(config, {...options, requireVision});
        if (config.provider === "opencode") return await inspectOpenCodeModel(config, {...options, requireVision});
        if (config.provider === "openrouter") return await inspectOpenRouterModel(config, {...options, requireVision});
        if (config.provider !== "ollama") return;
        await inspectOllamaModel(config.baseUrl, config.model, {...options, requireVision});
    } catch (error) {
        if (error?.code === 'AI_MODEL_UNAVAILABLE') {
            throw Object.assign(new Error(`${error.message}\nThe live-test CLI reads FDO_TEST_AI_MODEL from your environment, independently of FDO Settings. Update that variable and rerun the same command.`, {cause: error}),
                {code: error.code});
        }
        throw error;
    }
}

module.exports = {readLiveAiConfig, preflightLiveAi, liveThinkingMode, findLiveCodingAssistant};
