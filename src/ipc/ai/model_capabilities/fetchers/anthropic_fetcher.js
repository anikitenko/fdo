// src/main/ai/model_capabilities/fetchers/anthropic_fetcher.js
export async function fetchAnthropicCapabilities(apiKey, options = {}) {
    const {
        allowFallback = true,
        throwOnError = false,
    } = options;
    const headers = {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
    };

    let models = [];
    try {
        const res = await fetch("https://api.anthropic.com/v1/models", { headers });
        if (!res.ok) {
            let message = `HTTP ${res.status}`;
            try {
                const errorData = await res.json();
                if (errorData?.error?.type && errorData?.error?.message) {
                    message = `${errorData.error.type}: ${errorData.error.message}`;
                } else if (errorData?.error?.message) {
                    message = errorData.error.message;
                }
            } catch {
                // ignore parse failures and keep HTTP status
            }

            if (throwOnError) {
                throw new Error(message);
            }
        } else {
            const data = await res.json();
            if (Array.isArray(data?.data)) {
                models = data.data.map(m => ({
                    id: m.id,
                    provider: "anthropic",
                    reasoning: /(opus|sonnet)/i.test(m.id),
                    deterministic: false,
                    supportsTemperature: true,
                    supportsThinking: /(opus|sonnet)/i.test(m.id),
                    api: "responses",
                    maxField: "max_tokens",
                    streaming: true,
                    tools: /(opus|sonnet)/i.test(m.id),
                    maxTokens: m.context_length ?? 200_000,
                }));
            }
        }
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
                api: "responses",
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
                api: "responses",
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
                api: "responses",
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
                api: "responses",
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
                api: "responses",
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
                api: "responses",
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
                api: "responses",
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
                api: "responses",
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
                api: "responses",
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
                api: "responses",
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
                api: "responses",
                maxField: "max_tokens",
                streaming: true,
                tools: false,
                maxTokens: 100_000,
            },
        ];
    }

    return models;
}
