import {listOpenAIModels} from '../../../../utils/aiProviders/catalog';

export async function fetchOpenAICapabilities(apiKey) {
    try {
        const models = await listOpenAIModels(apiKey);
        // OpenAI's Models API does not expose capability flags. Keep family
        // defaults conservative; model access alone is not feature discovery.
        return models.map(model => {
            const legacyReasoning = /^o1-(mini|preview)(?:-|$)/.test(model.id);
            const reasoning = /^(gpt-5(?:[.-]|$)|o[134](?:-|$))/.test(model.id);
            const legacyChat = legacyReasoning || /^gpt-3\.5(?:-|$)/.test(model.id);
            return {id: model.id, provider: 'openai', api: legacyChat ? 'chat.completions' : 'responses',
                reasoning, deterministic: false, supportsTemperature: !reasoning,
                supportsThinking: reasoning && !legacyReasoning, streaming: true, tools: !legacyReasoning,
                maxField: legacyChat ? (legacyReasoning ? 'max_completion_tokens' : 'max_tokens') : 'max_output_tokens',
                maxTokens: model.max_context_length ?? 128000, maxOutputTokens: 8192};
        });
    } catch (error) {
        console.warn('[capabilities] OpenAI fetch failed:', {error: error.message});
        return [];
    }
}
