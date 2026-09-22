import {createGeminiClient} from '../geminiProvider.cjs';
import {completion, jsonInput, outputLimit} from './messages';

function completed(interaction, steps) {
    const errors = interaction.errors || [];
    if (errors.length) throw Object.assign(new Error(errors[0].message || 'Gemini generation failed.'), {code: errors[0].code});
    const all = interaction.steps || steps;
    for (const step of all) if (step.error) throw new Error(`Gemini generation failed: ${step.error.message || step.error.code}`);
    const calls = all.filter(step => step.type === 'function_call').map(step => ({id: step.id, name: step.name, input: jsonInput(step.arguments)}));
    const content = all.filter(step => step.type === 'model_output').flatMap(step => step.content || []).filter(part => part.type === 'text').map(part => part.text || '').join('');
    const usage = interaction.usage;
    const reason = interaction.status === 'requires_action' && calls.length ? 'tool_calls' : interaction.status;
    const result = completion(content, calls, usage && {input_tokens: usage.total_input_tokens, output_tokens: usage.total_output_tokens,
        total_tokens: usage.total_tokens, cached_input_tokens: usage.total_cached_tokens, reasoning_tokens: usage.total_thought_tokens}, reason);
    result.result.native = {gemini: all};
    return result;
}
export async function* geminiRequest(config, conversation, options, signal) {
    const client = await createGeminiClient({...config, signal});
    const input = conversation.messages.flatMap(message => message.native?.gemini || [{type: message.role === 'assistant' ? 'model_output' : 'user_input',
        content: [{type: 'text', text: message.content}, ...(message.attachments || []).map(attachment => ({type: attachment.mediaType.startsWith('image/') ? 'image' : 'document',
            mime_type: attachment.mediaType, ...(attachment.url ? {uri: attachment.url} : {data: attachment.data})}))]}]);
    const response = await client.interactions.create({model: options.model, input, system_instruction: conversation.system || undefined,
        ...(options.responseSchema ? {response_format: {type: 'text', mime_type: 'application/json', schema: options.responseSchema}} : {}),
        store: false, stream: !!options.stream, generation_config: {max_output_tokens: outputLimit(options),
            ...(options.reasoning?.effort ? {thinking_level: options.reasoning.effort} : {}),
            ...(options.think === true ? {thinking_summaries: 'auto'} : {})},
        ...(options.tools?.length ? {tools: options.tools.map(tool => ({type: 'function', name: tool.name, description: tool.description, parameters: tool.input_schema}))} : {}),
    }, {signal, maxRetries: 0, timeout: config.timeout});
    if (!options.stream) { yield completed(response, []); return; }
    const steps = new Map();
    const argumentsText = new Map();
    for await (const event of response) {
        yield {type: 'activity'};
        if (event.event_type === 'error') throw Object.assign(new Error(event.error?.message || 'Gemini stream failed.'), {code: event.error?.code});
        if (event.event_type === 'step.start') steps.set(event.index, structuredClone(event.step));
        if (event.event_type === 'step.delta') {
            const delta = event.delta;
            const step = steps.get(event.index);
            if (!step) throw new Error('Gemini sent a delta without a step declaration.');
            if (delta.type === 'text') {
                (step.content ||= []).push({type: 'text', text: delta.text});
                yield {type: 'content', content: delta.text || ''};
            }
            if (delta.type === 'thought_summary') {
                (step.summary ||= []).push(delta.content);
                if (delta.content?.text) yield {type: 'thinking', content: delta.content.text};
            }
            if (delta.type === 'thought_signature') step.signature = delta.signature;
            if (delta.type === 'arguments_delta') argumentsText.set(event.index, (argumentsText.get(event.index) || '') + (delta.arguments || ''));
        }
        if (event.event_type === 'step.stop' && argumentsText.has(event.index)) steps.get(event.index).arguments = jsonInput(argumentsText.get(event.index));
        if (event.event_type === 'interaction.completed') {
            const result = completed(event.interaction, [...steps.values()]);
            yield result;
            return;
        }
    }
    throw new Error('Gemini stream ended without successful completion; no changes were applied.');
}
