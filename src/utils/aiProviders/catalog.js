import {createAnthropicClient} from './anthropic';
import {createOpenAIClient} from './openai';

export async function listOpenAIModels(apiKey, {fetchImpl = globalThis.fetch} = {}) {
    const key = String(apiKey || '').trim();
    if (!key) throw new Error('An API key is required for OpenAI.');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
        const client = await createOpenAIClient({apiKey: key, maxRetries: 0, fetch: (url, init) => fetchImpl(url, {...init, redirect: 'error'})});
        const models = [];
        for await (const model of client.models.list({signal: controller.signal})) models.push(model);
        return models;
    } catch (error) { throw new Error(String(error?.message || error).split(key).join('[REDACTED]')); }
    finally { clearTimeout(timer); }
}

export async function listAnthropicModels(apiKey, {fetchImpl = globalThis.fetch} = {}) {
    const key = String(apiKey || '').trim();
    if (!key) throw new Error('An API key is required for Anthropic.');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
        const client = await createAnthropicClient({apiKey: key, maxRetries: 0, fetch: (url, init) => fetchImpl(url, {...init, redirect: 'error'})});
        const models = [];
        for await (const model of client.models.list({limit: 100}, {signal: controller.signal})) models.push({id: model.id, label: model.display_name || model.id,
            value: model.id, provider: 'anthropic', modelMetadata: model});
        return models;
    } catch (error) { throw new Error(String(error?.message || error).split(key).join('[REDACTED]')); }
    finally { clearTimeout(timer); }
}
