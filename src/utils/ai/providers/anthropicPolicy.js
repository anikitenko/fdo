import {outputLimit} from './messages';

// The SDK client is already scoped to one credential. A WeakMap keeps metadata
// isolated to that client without retaining or hashing API keys.
const metadataCache = new WeakMap();
export async function anthropicMetadata(client, options, signal) {
    if (options.modelMetadata) return options.modelMetadata;
    let clientCache = metadataCache.get(client);
    if (!clientCache) {
        clientCache = new Map();
        metadataCache.set(client, clientCache);
    }
    const key = options.model;
    const cached = clientCache.get(key);
    if (cached && cached.expires > Date.now()) return cached.value;
    const value = await client.models.retrieve(options.model, {}, {signal, timeout: 15000});
    if (clientCache.size >= 100) clientCache.delete(clientCache.keys().next().value);
    clientCache.set(key, {value, expires: Date.now() + 15 * 60 * 1000});
    return value;
}
export function anthropicParameters(options, metadata, attachments = []) {
    const capabilities = metadata.capabilities || {};
    for (const attachment of attachments) {
        const capability = attachment.mediaType.startsWith('image/') ? capabilities.image_input : capabilities.pdf_input;
        if (capability?.supported === false) throw new Error(`Selected Claude model does not support ${attachment.mediaType.startsWith('image/') ? 'images' : 'PDFs'}.`);
    }
    const limit = Number(metadata.max_tokens) > 0 ? Math.min(outputLimit(options), metadata.max_tokens) : outputLimit(options);
    const params = {max_tokens: limit};
    if (options.think === true) {
        const thinking = capabilities.thinking;
        if (thinking?.supported === false) throw new Error('Selected Claude model does not support thinking.');
        if (thinking?.types?.adaptive?.supported) {
            params.thinking = {type: 'adaptive', display: 'summarized'};
            if (options.reasoning?.effort) {
                const effort = options.reasoning.effort;
                if (capabilities.effort?.[effort]?.supported !== true) throw new Error(`Selected Claude model does not support effort '${effort}'.`);
                params.output_config = {effort};
            }
        } else if (thinking?.types?.enabled?.supported) {
            const budget = options.max_thinking_tokens ?? 2048;
            if (!Number.isInteger(budget) || budget < 1024 || budget >= limit) throw new Error('Claude thinking budget must be at least 1024 tokens and smaller than the output limit.');
            params.thinking = {type: 'enabled', budget_tokens: budget};
        } else throw new Error('Claude thinking capabilities are unavailable. Refresh model metadata before enabling thinking.');
    }
    // Leave provider/model defaults intact when thinking is automatic. In
    // particular, never send sampling controls alongside enabled thinking.
    if (!params.thinking && options.temperature != null && !capabilities.thinking?.types?.adaptive?.supported) params.temperature = options.temperature;
    return params;
}
