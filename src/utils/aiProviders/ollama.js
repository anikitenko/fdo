import {chatTools, completion, outputLimit, tokenUsage} from './messages';
import {normalizeOllamaBaseUrl} from '../ollamaProvider.cjs';

export async function* ollamaRequest(config, conversation, options) {
    const {Ollama} = await import('ollama');
    const client = new Ollama({host: normalizeOllamaBaseUrl(options.baseUrl), fetch: config.fetch});
    const messages = [...(conversation.system ? [{role: 'system', content: conversation.system}] : []), ...conversation.messages.map(message => {
        if (message.attachments?.some(attachment => !attachment.mediaType.startsWith('image/') || attachment.url)) throw new Error('Ollama requires base64 image attachments.');
        return {role: message.role, content: message.content, ...(message.attachments?.length ? {images: message.attachments.map(attachment => attachment.data)} : {})};
    })];
    const response = await client.chat({model: options.model, messages, stream: !!options.stream, tools: chatTools(options.tools),
        ...(options.responseSchema ? {format: options.responseSchema} : {}),
        ...(typeof options.think === 'boolean' ? {think: options.think} : {}),
        options: {...options.options, num_predict: outputLimit(options), ...(options.temperature != null ? {temperature: options.temperature} : {})}});
    let text = '';
    const calls = [];
    try {
        for await (const event of options.stream ? response : [response]) {
            if (event.message?.content) { text += event.message.content; yield {type: 'content', content: event.message.content}; }
            if (event.message?.thinking) yield {type: 'thinking', content: event.message.thinking};
            for (const call of event.message?.tool_calls || []) calls.push({id: call.id || `ollama-${calls.length}`, name: call.function.name, input: call.function.arguments});
            if (event.done) { yield completion(text, calls, tokenUsage(event), event.done_reason); return; }
        }
        throw new Error('Ollama stream ended without successful completion.');
    } finally { client.abort(); }
}
