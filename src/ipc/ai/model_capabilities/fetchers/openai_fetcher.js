export async function fetchOpenAICapabilities(apiKey) {
    const headers = { Authorization: `Bearer ${apiKey}` };

    try {
        const res = await fetch("https://api.openai.com/v1/models", { headers });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();

        // Explicit allowlists for current families
        const reasoningModels = ["o1-preview", "o1-mini"];
        const deterministicModels = ["gpt-5", "gpt-5-preview", "gpt-5-turbo"];

        return (data.data || []).map(m => {
            const id = m.id;
            const reasoning = reasoningModels.includes(id);
            const deterministic = deterministicModels.includes(id);
            const supportsTemperature = !(reasoning || deterministic);
            const apiType = reasoning ? "chat.completions" : "responses";
            const maxField = "max_output_tokens";

            return {
                id,
                provider: "openai",
                api: apiType,
                reasoning,
                deterministic,
                supportsTemperature,
                supportsThinking: reasoning,          // reasoning.effort
                streaming: true,
                tools: true,
                maxField,                             // which field to use
                maxTokens: m.max_context_length ?? 128_000,
            };
        });
    } catch (err) {
        console.warn("[capabilities] OpenAI fetch failed:", err.message);
        return [];
    }
}
