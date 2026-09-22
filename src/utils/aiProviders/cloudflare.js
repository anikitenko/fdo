import {chatTools, completion, dataUrl, jsonInput, outputLimit, tokenUsage} from './messages';
import {readCodingStreamEvents, CODING_STREAM_DONE} from '../codingLlmStream';
import {cloudflareError, cloudflareRunPath} from '../cloudflareProvider.cjs';
import {cloudflareStreamDiagnostics} from './cloudflareStreamDiagnostics';

export async function* cloudflareRequest(config, conversation, options, signal) {
    const {default: Cloudflare} = await import('cloudflare');
    const client = new Cloudflare({...config, apiToken: config.apiKey, apiKey: null, apiEmail: null, userServiceKey: null,
        baseURL: 'https://api.cloudflare.com/client/v4'});
    // Native Workers AI JSON mode takes a bare schema and does not support
    // streaming. Keep the application's event interface, but send one bounded
    // JSON request for structured stages. File-format recovery can explicitly
    // request buffered source too, without asking the model to JSON-escape it.
    // Other unstructured requests still use SSE.
    // https://developers.cloudflare.com/workers-ai/features/json-mode/
    const stream = !!options.stream && !options.responseSchema && !options.bufferedResponse;
    // Tell the shared progress display about the actual wire mode; the caller
    // still consumes an event iterator for a buffered structured response.
    yield {type: 'response-mode', mode: stream ? 'streaming' : 'buffered'};
    const messages = [...(conversation.system ? [{role: 'system', content: conversation.system}] : []), ...conversation.messages.map(message => ({
        role: message.role, content: message.attachments?.length ? [{type: 'text', text: message.content}, ...message.attachments.map(attachment => {
            if (!attachment.mediaType.startsWith('image/')) throw new Error('Cloudflare coding requests support image attachments only.');
            return {type: 'image_url', image_url: {url: dataUrl(attachment)}};
        })] : message.content,
    }))];
    // Preserve model-path slashes through the SDK's public request API.
    // See README.md#cloudflare-model-path-compatibility for the SDK rationale.
    const response = await client.post(cloudflareRunPath(options), {signal, body: {messages, stream,
        max_tokens: outputLimit(options), temperature: options.temperature,
        ...(stream ? {stream_options: {include_usage: true}} : {}),
        ...(options.responseSchema ? {response_format: {type: 'json_schema', json_schema: options.responseSchema}} : {}),
        ...(options.tools?.length ? {tools: chatTools(options.tools)} : {}),
        ...(typeof options.think === 'boolean' ? {chat_template_kwargs: {enable_thinking: options.think}} : {}),
        ...(options.reasoning?.effort ? {reasoning_effort: options.reasoning.effort} : {}),
    }}).asResponse();
    const checkError = event => {
        if (event?.error || event?.errors?.length || event?.success === false) throw cloudflareError(event, response.status, config.apiKey);
    };
    if (!stream) {
        const envelope = await response.json();
        checkError(envelope);
        const result = envelope.result ?? envelope;
        checkError(result);
        const choice = result.choices?.[0];
        const calls = (result.tool_calls || choice?.message?.tool_calls || []).map((call, i) => ({id: call.id || `cf-${i}`, name: call.function?.name || call.name,
            input: jsonInput(call.function?.arguments ?? call.arguments)}));
        const usage = tokenUsage(result.usage);
        if (result.usage) yield {type: 'usage', usage, complete: true};
        const reason = result.finish_reason ?? choice?.finish_reason;
        // Chat-shaped results require an explicit completion signal. Legacy
        // Workers AI returns a complete response object without finish_reason.
        if (Array.isArray(result.choices) && !reason) {
            throw new Error('Cloudflare response ended without a finish_reason; no changes were applied.');
        }
        const answer = result.response ?? choice?.message?.content ?? '';
        const text = options.responseSchema && answer && typeof answer === 'object' ? JSON.stringify(answer) : answer;
        const done = completion(text, calls, usage, reason ?? 'stop');
        // Validate provider completion before exposing the structured text.
        if (options.stream && typeof text === 'string' && text) yield {type: 'content', content: text};
        yield done;
        return;
    }
    if (!response.body || !response.headers.get('content-type')?.includes('text/event-stream')) {
        await response.body?.cancel();
        throw new Error('Cloudflare returned a non-SSE response to a streaming request. No changes were applied.');
    }
    let text = '', reason, usage;
    const diagnostics = cloudflareStreamDiagnostics(response.status, options.think);
    const calls = new Map();
    try {
        for await (const event of readCodingStreamEvents(response.body, {includeDone: true, onEvent: (event, name) => {
            if (name === 'error') throw cloudflareError(event?.error || event?.errors ? event : {error: event}, response.status, config.apiKey);
        }})) {
            if (event === CODING_STREAM_DONE) { diagnostics.counts.done = true; reason ??= 'stop'; break; }
            checkError(event);
            const payload = event?.result ?? event;
            checkError(payload);
            diagnostics.observe(event, payload);
            const choice = payload?.choices?.[0];
            const delta = choice?.delta;
            const content = payload?.response ?? delta?.content;
            const thinking = delta?.reasoning_content ?? delta?.reasoning ?? payload?.reasoning;
            // Count even role/usage-only events without exposing provider output.
            yield {type: 'activity'};
            if (typeof content === 'string') { diagnostics.counts.answerCharacters += content.length; text += content; yield {type: 'content', content}; }
            if (typeof thinking === 'string') { diagnostics.counts.reasoningCharacters += thinking.length; yield {type: 'thinking', content: thinking}; }
            for (const call of delta?.tool_calls || []) {
                const previous = calls.get(call.index) || {id: '', name: '', arguments: ''};
                previous.id = call.id || previous.id;
                previous.name += call.function?.name || '';
                previous.arguments += call.function?.arguments || '';
                calls.set(call.index, previous);
            }
            if (payload?.usage) { diagnostics.counts.usage = true; usage = tokenUsage(payload.usage); yield {type: 'usage', usage, complete: true}; }
            if (payload?.finish_reason || choice?.finish_reason) {
                diagnostics.counts.finish = true;
                reason = payload.finish_reason || choice.finish_reason;
                // Reject truncation immediately, even if the connection stays open.
                completion(text, [], usage, reason);
            }
        }
    } catch (error) {
        if (error instanceof SyntaxError) throw new Error(`Cloudflare sent malformed stream data; no changes were applied. ${diagnostics.summary()}`);
        throw error;
    }
    if (!reason) {
        const reasoningOnly = diagnostics.counts.reasoningCharacters > 0 && diagnostics.counts.answerCharacters === 0;
        const hint = reasoningOnly ? ' Only reasoning was received, with no answer text. '
            + (options.think === false ? 'Reasoning was returned even though enable_thinking=false was sent. '
                : 'Set this coding assistant’s thinking mode to Off to disable optional reasoning. ') : ' ';
        throw new Error(`Cloudflare stream ended before a completion event; no changes were applied.${hint}${diagnostics.summary()}`);
    }
    yield completion(text, [...calls.values()].map(call => ({id: call.id, name: call.name, input: jsonInput(call.arguments)})), usage, reason);
}
