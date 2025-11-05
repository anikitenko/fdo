// src/main/ai/model_capabilities/fetchers/openai_fetcher.js
export async function fetchOpenAICapabilities(apiKey) {
    const headers = { Authorization: `Bearer ${apiKey}` };

    try {
        const res = await fetch("https://api.openai.com/v1/models", { headers });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();

        return (data.data || []).map(m => ({
            id: m.id,
            provider: "openai",
            reasoning: /reason|gpt-5|o[13]/i.test(m.id),
            streaming: true,
            tools: true,
            maxTokens: m.max_context_length ?? 128_000,
        }));
    } catch (err) {
        console.warn("[capabilities] OpenAI fetch failed:", err.message);
        return [];
    }
}
