import {listAnthropicModels} from "../../../../utils/aiProviders/catalog";
// src/main/ai/model_capabilities/fetchers/anthropic_fetcher.js
export async function fetchAnthropicCapabilities(apiKey, options = {}) {
    const {
        allowFallback = true,
        throwOnError = false,
    } = options;
    let models = [];
    try {
        const catalog = await listAnthropicModels(apiKey);
        models = catalog.map(({id, modelMetadata}) => ({id, provider: "anthropic", api: "messages", streaming: true, tools: true,
            reasoning: modelMetadata.capabilities?.thinking?.supported === true,
            supportsThinking: modelMetadata.capabilities?.thinking?.supported === true,
            supportsTemperature: !modelMetadata.capabilities?.thinking?.types?.adaptive?.supported,
            maxField: "max_tokens", maxTokens: modelMetadata.max_input_tokens || 200000,
            maxOutputTokens: modelMetadata.max_tokens || 8192, modelMetadata}));
    } catch (err) {
        console.warn("[capabilities] Anthropic fetch failed:", err.message);
        if (throwOnError) {
            throw err;
        }
    }

    if (models.length === 0 && allowFallback) {
        // Static fallback
        models = [
            // --- Claude 4.5 Series ---
            {
                id: "claude-haiku-4-5-20251001",
                provider: "anthropic",
                reasoning: false,
                deterministic: false,
                supportsTemperature: true,
                supportsThinking: false,
                api: "messages",
                maxField: "max_tokens",
                streaming: true,
                tools: false,
                maxTokens: 100_000,
            },
            {
                id: "claude-sonnet-4-5-20250929",
                provider: "anthropic",
                reasoning: true,
                deterministic: false,
                supportsTemperature: true,
                supportsThinking: true,
                api: "messages",
                maxField: "max_tokens",
                streaming: true,
                tools: true,
                maxTokens: 200_000,
            },

            // --- Claude 4.1 / 4 Series ---
            {
                id: "claude-opus-4-1-20250805",
                provider: "anthropic",
                reasoning: true,
                deterministic: false,
                supportsTemperature: true,
                supportsThinking: true,
                api: "messages",
                maxField: "max_tokens",
                streaming: true,
                tools: true,
                maxTokens: 200_000,
            },
            {
                id: "claude-opus-4-20250514",
                provider: "anthropic",
                reasoning: true,
                deterministic: false,
                supportsTemperature: true,
                supportsThinking: true,
                api: "messages",
                maxField: "max_tokens",
                streaming: true,
                tools: true,
                maxTokens: 200_000,
            },
            {
                id: "claude-sonnet-4-20250514",
                provider: "anthropic",
                reasoning: true,
                deterministic: false,
                supportsTemperature: true,
                supportsThinking: true,
                api: "messages",
                maxField: "max_tokens",
                streaming: true,
                tools: true,
                maxTokens: 200_000,
            },

            // --- Claude 3.x Series ---
            {
                id: "claude-3-7-sonnet-20250219",
                provider: "anthropic",
                reasoning: true,
                deterministic: false,
                supportsTemperature: true,
                supportsThinking: true,
                api: "messages",
                maxField: "max_tokens",
                streaming: true,
                tools: true,
                maxTokens: 200_000,
            },
            {
                id: "claude-3-5-haiku-20241022",
                provider: "anthropic",
                reasoning: false,
                deterministic: false,
                supportsTemperature: true,
                supportsThinking: false,
                api: "messages",
                maxField: "max_tokens",
                streaming: true,
                tools: false,
                maxTokens: 100_000,
            },
            {
                id: "claude-3-haiku-20240307",
                provider: "anthropic",
                reasoning: false,
                deterministic: false,
                supportsTemperature: true,
                supportsThinking: false,
                api: "messages",
                maxField: "max_tokens",
                streaming: true,
                tools: false,
                maxTokens: 100_000,
            },

            // --- Legacy (general fallback) ---
            {
                id: "claude-opus-4",
                provider: "anthropic",
                reasoning: true,
                deterministic: false,
                supportsTemperature: true,
                supportsThinking: true,
                api: "messages",
                maxField: "max_tokens",
                streaming: true,
                tools: true,
                maxTokens: 200_000,
            },
            {
                id: "claude-sonnet-4.5",
                provider: "anthropic",
                reasoning: true,
                deterministic: false,
                supportsTemperature: true,
                supportsThinking: true,
                api: "messages",
                maxField: "max_tokens",
                streaming: true,
                tools: true,
                maxTokens: 200_000,
            },
            {
                id: "claude-haiku-4.5",
                provider: "anthropic",
                reasoning: false,
                deterministic: false,
                supportsTemperature: true,
                supportsThinking: false,
                api: "messages",
                maxField: "max_tokens",
                streaming: true,
                tools: false,
                maxTokens: 100_000,
            },
        ];
    }

    return models;
}
