import {chatTools, completion, dataUrl, jsonInput, openaiTools, outputLimit, tokenUsage} from './messages';

export async function createOpenAIClient(config) {
    const {default: OpenAI} = await import('openai');
    return new OpenAI({...config, baseURL: 'https://api.openai.com/v1', organization: null, project: null});
}
function result(response, fallbackText = '', fallbackCalls = []) {
    const output = response.output || [];
    const text = output.filter(item => item.type === 'message').flatMap(item => item.content || [])
        .filter(item => item.type === 'output_text').map(item => item.text).join('');
    const calls = output.filter(item => item.type === 'function_call').map(item => ({id: item.call_id, name: item.name, input: jsonInput(item.arguments)}));
    if (response.error) throw Object.assign(new Error(response.error.message), {code: response.error.code});
    const completed = completion(text || fallbackText, calls.length ? calls : fallbackCalls, tokenUsage(response.usage), response.incomplete_details?.reason || response.status);
    if (response.service_tier) completed.result.serviceTier = response.service_tier;
    return completed;
}
export async function* openaiRequest(config, conversation, options, signal) {
    const client = await createOpenAIClient(config);
    if (options.api === 'chat.completions' || /^(o1-(mini|preview)|gpt-3\.5)(?:-|$)/.test(options.model)) {
        yield* chatCompletionRequest(client, conversation, options, signal);
        return;
    }
    const input = conversation.messages.map(message => ({role: message.role, content: message.attachments?.length
        ? [{type: 'input_text', text: message.content}, ...message.attachments.map(attachment => attachment.mediaType.startsWith('image/')
            ? {type: 'input_image', image_url: dataUrl(attachment), detail: 'auto'}
            : {type: 'input_file', ...(attachment.url ? {file_url: attachment.url} : {filename: 'attachment.pdf', file_data: dataUrl(attachment)})})]
        : message.content}));
    const response = await client.responses.create({model: options.model, instructions: conversation.system || undefined, input,
        max_output_tokens: outputLimit(options), stream: !!options.stream, store: false,
        ...(options.responseSchema ? {text: {format: {type: 'json_schema', name: 'response', strict: true, schema: options.responseSchema}}} : {}),
        temperature: /^(gpt-5|o[134])/.test(options.model) ? undefined : options.temperature, reasoning: options.reasoning ? {summary: "auto", ...options.reasoning} : undefined, tools: openaiTools(options.tools)}, {signal});
    if (!options.stream) { yield result(response); return; }
    let text = '';
    const calls = [];
    for await (const event of response) {
        if (event.type === 'response.output_text.delta') { text += event.delta; yield {type: 'content', content: event.delta}; }
        if (['response.reasoning_text.delta', 'response.reasoning_summary_text.delta'].includes(event.type)) yield {type: 'thinking', content: event.delta};
        if (event.type === 'response.output_item.done' && event.item?.type === 'function_call') calls.push({id: event.item.call_id, name: event.item.name, input: jsonInput(event.item.arguments)});
        if (event.type === 'error') throw Object.assign(new Error(event.message || 'OpenAI stream failed.'), {code: event.code});
        if (['response.completed', 'response.incomplete', 'response.failed'].includes(event.type)) {
            yield {type: 'usage', usage: tokenUsage(event.response.usage), complete: true, serviceTier: event.response.service_tier};
            yield result(event.response, text, calls);
            return;
        }
    }
    throw new Error('Assistant stream ended without successful completion; no changes were applied.');
}

// Keep legacy Chat Completions models usable without routing other providers
// through OpenAI compatibility APIs.
async function* chatCompletionRequest(client, conversation, options, signal) {
    const messages = [...(conversation.system ? [{role: 'system', content: conversation.system}] : []), ...conversation.messages.map(message => ({
        role: message.role, content: message.attachments?.length ? [{type: 'text', text: message.content}, ...message.attachments.map(attachment => {
            if (!attachment.mediaType.startsWith('image/')) throw new Error('This Chat Completions integration supports image attachments only.');
            return {type: 'image_url', image_url: {url: dataUrl(attachment)}};
        })] : message.content,
    }))];
    const response = await client.chat.completions.create({model: options.model, messages, stream: !!options.stream,
        ...(options.responseSchema ? {response_format: {type: 'json_schema', json_schema: {name: 'response', strict: true, schema: options.responseSchema}}} : {}),
        ...(options.stream ? {stream_options: {include_usage: true}} : {}),
        ...(/^o[134]/.test(options.model) ? {max_completion_tokens: outputLimit(options)} : {max_tokens: outputLimit(options), temperature: options.temperature}),
        ...(options.tools?.length ? {tools: chatTools(options.tools)} : {}),
    }, {signal});
    if (!options.stream) {
        const choice = response.choices[0];
        yield completion(choice.message.content || '', (choice.message.tool_calls || []).map(call => ({id: call.id, name: call.function.name, input: jsonInput(call.function.arguments)})), tokenUsage(response.usage), choice.finish_reason);
        return;
    }
    let text = '', reason, usage;
    const calls = new Map();
    for await (const event of response) {
        const choice = event.choices?.[0];
        if (choice?.delta?.content) { text += choice.delta.content; yield {type: 'content', content: choice.delta.content}; }
        for (const call of choice?.delta?.tool_calls || []) {
            const value = calls.get(call.index) || {id: '', name: '', arguments: ''};
            value.id = call.id || value.id;
            value.name += call.function?.name || '';
            value.arguments += call.function?.arguments || '';
            calls.set(call.index, value);
        }
        if (choice?.finish_reason) { reason = choice.finish_reason; completion(text, [], usage, reason); }
        if (event.usage) { usage = tokenUsage(event.usage); yield {type: 'usage', usage, complete: true, serviceTier: event.service_tier}; }
    }
    yield completion(text, [...calls.values()].map(call => ({id: call.id, name: call.name, input: jsonInput(call.arguments)})), usage, reason);
}
