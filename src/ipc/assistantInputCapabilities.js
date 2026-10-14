import {assistantInputCapabilities} from '../utils/ai/assistant/aiAssistantInputCapabilities';
import {inspectCursorModel} from '../utils/ai/providers/cursorProvider';
import {inspectOpenRouterModel} from '../utils/ai/providers/openRouterProvider.cjs';
import {inspectOpenCodeModel} from '../utils/ai/providers/opencodeProvider.cjs';
import {inspectOllamaModel} from '../utils/ai/providers/ollamaProvider.cjs';
import {inspectCloudflareModel} from '../utils/ai/providers/cloudflareProvider.cjs';
import {inspectGeminiModel} from '../utils/ai/providers/geminiProvider.cjs';
import {listOpenAIModels, listAnthropicModels} from '../utils/ai/providers/catalog';

// Metadata discovery only: never spend an inference request to probe images.
export async function discoverAssistantInputCapabilities(assistant) {
    let metadata = {};
    if (assistant.provider === 'cursor') metadata = (await inspectCursorModel(assistant)).modelMetadata;
    else if (assistant.provider === 'openrouter') metadata = await inspectOpenRouterModel(assistant);
    else if (assistant.provider === 'opencode') metadata = await inspectOpenCodeModel(assistant);
    else if (assistant.provider === 'ollama') metadata = await inspectOllamaModel(assistant.baseUrl, assistant.model);
    else if (assistant.provider === 'cloudflare') metadata = await inspectCloudflareModel(assistant, {includeInputCapabilities: true});
    else if (assistant.provider === 'gemini') metadata = await inspectGeminiModel(assistant);
    else if (assistant.provider === 'openai') metadata = (await listOpenAIModels(assistant.apiKey)).find(model => model.id === assistant.model) || {};
    else if (assistant.provider === 'anthropic') metadata = (await listAnthropicModels(assistant.apiKey)).find(model => model.id === assistant.model)?.modelMetadata || {};
    return {...assistantInputCapabilities({...assistant, inputCapabilities: undefined}, metadata), checkedAt: new Date().toISOString()};
}
