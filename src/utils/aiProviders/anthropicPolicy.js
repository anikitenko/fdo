import {createHash} from 'node:crypto';
import {outputLimit} from './messages';

const metadataCache = new Map();
export async function anthropicMetadata(client, options, signal) {
    if (options.modelMetadata) return options.modelMetadata;
    // Scope metadata to credential + model without retaining the credential.
    const key = createHash('sha256').update(`${options.apiKey}\0${options.model}`).digest('hex');
    const cached = metadataCache.get(key);
    if (cached && cached.expires > Date.now()) return cached.value;
    const value = await client.models.retrieve(options.model, {}, {signal, timeout: 15000});
    if (metadataCache.size >= 100) metadataCache.delete(metadataCache.keys().next().value);
    metadataCache.set(key, {value, expires: Date.now() + 15 * 60 * 1000});
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
