// Only FDO's message/attachment boundary is shared. Wire formats stay native.
export function conversation(messages, prompt, attachments) {
    return {
        system: messages.filter(message => message.role === 'system').map(message => message.content).join('\n\n'),
        messages: [...messages.filter(message => message.role !== 'system'), {role: 'user', content: prompt, attachments}],
    };
}
export const outputLimit = options => options.max_output_tokens ?? options.max_completion_tokens ?? options.max_tokens ?? 8192;
export const jsonInput = value => typeof value === 'string' ? JSON.parse(value || '{}') : value || {};
export const openaiTools = tools => (tools || []).map(tool => ({type: 'function', name: tool.name, description: tool.description, parameters: tool.input_schema, strict: false}));
export const chatTools = tools => openaiTools(tools).map(({type, ...fn}) => ({type, function: fn}));
export const dataUrl = attachment => attachment.url || `data:${attachment.mediaType};base64,${attachment.data}`;
export function completion(content, calls, usage, reason) {
    if (['length', 'max_tokens', 'max_output_tokens', 'model_length'].includes(reason)) throw Object.assign(new Error('Assistant stream response.incomplete: max_tokens'), {usage});
    if (!['stop', 'completed', 'end_turn', 'stop_sequence', 'tool_calls', 'tool_use'].includes(reason)) {
        throw Object.assign(new Error(`Assistant stream ended without successful completion (${reason || 'missing finish reason'}); no changes were applied.`), {usage});
    }
    return {type: 'result', reason, result: {content, tool_calls: calls, usage}};
}
export function tokenUsage(value) {
    if (!value) return undefined;
    const cached = value.cache_read_input_tokens ?? value.input_tokens_details?.cached_tokens ?? value.prompt_tokens_details?.cached_tokens;
    const cacheWrite = value.cache_creation_input_tokens ?? value.input_tokens_details?.cache_write_tokens;
    const reasoning = value.output_tokens_details?.reasoning_tokens ?? value.completion_tokens_details?.reasoning_tokens;
    const input = value.input_tokens ?? value.prompt_tokens ?? value.prompt_eval_count;
    const output = value.output_tokens ?? value.completion_tokens ?? value.eval_count;
    // Claude reports cache reads/writes separately from uncached input tokens.
    const totalInput = input == null ? input : input + (value.cache_read_input_tokens || 0) + (value.cache_creation_input_tokens || 0);
    return {input_tokens: totalInput, output_tokens: output, total_tokens: value.total_tokens ?? (totalInput != null && output != null ? totalInput + output : undefined),
        ...(cached != null ? {cached_input_tokens: cached} : {}), ...(cacheWrite != null ? {cache_write_tokens: cacheWrite} : {}),
        ...(value.cache_creation?.ephemeral_1h_input_tokens != null ? {cache_write_1h_tokens: value.cache_creation.ephemeral_1h_input_tokens} : {}),
        ...(reasoning != null ? {reasoning_tokens: reasoning} : {})};
}
