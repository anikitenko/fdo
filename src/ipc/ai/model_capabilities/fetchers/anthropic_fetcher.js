// src/main/ai/model_capabilities/fetchers/anthropic_fetcher.js
export async function fetchAnthropicCapabilities(apiKey) {
    const headers = {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
    };

    let models = [];
    try {
        const res = await fetch("https://api.anthropic.com/v1/models", { headers });
        if (res.ok) {
            const data = await res.json();
            if (Array.isArray(data?.data)) {
                models = data.data.map(m => ({
                    id: m.id,
                    provider: "anthropic",
                    reasoning: /(opus|sonnet)/i.test(m.id),
                    streaming: true,
                    tools: /(opus|sonnet)/i.test(m.id),
                    maxTokens: m.context_length ?? 200_000,
                }));
            }
        }
    } catch (err) {
        console.warn("[capabilities] Anthropic fetch failed:", err.message);
    }

    if (models.length === 0) {
        // Static fallback
        models = [
            // --- Claude 4.5 Series ---
            {
                id: "claude-haiku-4-5-20251001",
                provider: "anthropic",
                reasoning: false,
                streaming: true,
                tools: false,
                maxTokens: 100_000,
            },
            {
                id: "claude-sonnet-4-5-20250929",
                provider: "anthropic",
                reasoning: true,
                streaming: true,
                tools: true,
                maxTokens: 200_000,
            },

            // --- Claude 4.1 / 4 Series ---
            {
                id: "claude-opus-4-1-20250805",
                provider: "anthropic",
                reasoning: true,
                streaming: true,
                tools: true,
                maxTokens: 200_000,
            },
            {
                id: "claude-opus-4-20250514",
                provider: "anthropic",
                reasoning: true,
                streaming: true,
                tools: true,
                maxTokens: 200_000,
            },
            {
                id: "claude-sonnet-4-20250514",
                provider: "anthropic",
                reasoning: true,
                streaming: true,
                tools: true,
                maxTokens: 200_000,
            },

            // --- Claude 3.x Series ---
            {
                id: "claude-3-7-sonnet-20250219",
                provider: "anthropic",
                reasoning: true,
                streaming: true,
                tools: true,
                maxTokens: 200_000,
            },
            {
                id: "claude-3-5-haiku-20241022",
                provider: "anthropic",
                reasoning: false,
                streaming: true,
                tools: false,
                maxTokens: 100_000,
            },
            {
                id: "claude-3-haiku-20240307",
                provider: "anthropic",
                reasoning: false,
                streaming: true,
                tools: false,
                maxTokens: 100_000,
            },

            // --- Legacy (general fallback) ---
            {
                id: "claude-opus-4",
                provider: "anthropic",
                reasoning: true,
                streaming: true,
                tools: true,
                maxTokens: 200_000,
            },
            {
                id: "claude-sonnet-4.5",
                provider: "anthropic",
                reasoning: true,
                streaming: true,
                tools: true,
                maxTokens: 200_000,
            },
            {
                id: "claude-haiku-4.5",
                provider: "anthropic",
                reasoning: false,
                streaming: true,
                tools: false,
                maxTokens: 100_000,
            },
        ];
    }

    return models;
}
