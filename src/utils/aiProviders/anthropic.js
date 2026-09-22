import {anthropicMetadata, anthropicParameters} from './anthropicPolicy';
import {completion, jsonInput, tokenUsage} from './messages';

export async function createAnthropicClient(config) {
    const {default: Anthropic} = await import('@anthropic-ai/sdk');
    return new Anthropic({...config, baseURL: 'https://api.anthropic.com', authToken: null});
}
export async function* anthropicRequest(config, conversation, options, signal) {
    const client = await createAnthropicClient(config);
    const metadata = await anthropicMetadata(client, options, signal);
    const parameters = anthropicParameters(options, metadata, conversation.messages.flatMap(message => message.attachments || []));
    const messages = conversation.messages.map(message => ({role: message.role, content: message.attachments?.length
        ? [{type: 'text', text: message.content}, ...message.attachments.map(attachment => ({
            type: attachment.mediaType.startsWith('image/') ? 'image' : 'document',
            source: attachment.url ? {type: 'url', url: attachment.url} : {type: 'base64', media_type: attachment.mediaType, data: attachment.data},
        }))] : message.content}));
    const response = await client.messages.create({model: options.model, system: conversation.system || undefined, messages,
        ...parameters, stream: !!options.stream,
        ...(options.responseSchema ? {output_config: {...parameters.output_config, format: {type: 'json_schema', schema: options.responseSchema}}} : {}),
        ...(conversation.system ? {system: [{type: 'text', text: conversation.system, cache_control: {type: 'ephemeral'}}]} : {}),
        tools: options.tools?.map(({name, description, input_schema}) => ({name, description, input_schema}))}, {signal});
    if (!options.stream) {
        yield completion(response.content.filter(block => block.type === 'text').map(block => block.text).join(''),
            response.content.filter(block => block.type === 'tool_use').map(block => ({id: block.id, name: block.name, input: block.input})), tokenUsage(response.usage), response.stop_reason);
        return;
    }
    let text = '', reason;
    let usage = {};
    const blocks = new Map();
    for await (const event of response) {
        if (event.type === 'message_start') { usage = {...event.message.usage}; yield {type: 'usage', usage: tokenUsage(usage), complete: false}; }
        if (event.type === 'content_block_start' && event.content_block.type === 'tool_use') blocks.set(event.index, {...event.content_block, json: ''});
        if (event.type === 'content_block_delta') {
            const delta = event.delta;
            if (delta.type === 'text_delta') { text += delta.text; yield {type: 'content', content: delta.text}; }
            if (delta.type === 'thinking_delta') yield {type: 'thinking', content: delta.thinking};
            if (delta.type === 'input_json_delta') {
                if (!blocks.has(event.index)) throw new Error('Anthropic sent tool arguments without a tool declaration.');
                blocks.get(event.index).json += delta.partial_json;
            }
        }
        if (event.type === 'message_delta') { reason = event.delta.stop_reason; usage = {...usage, ...event.usage}; yield {type: 'usage', usage: tokenUsage(usage), complete: !!reason}; }
        if (event.type === 'message_stop') {
            yield completion(text, [...blocks.values()].map(block => ({id: block.id, name: block.name, input: block.json ? jsonInput(block.json) : block.input})), tokenUsage(usage), reason);
            return;
        }
    }
    throw new Error('Assistant stream ended without successful completion; no changes were applied.');
}
