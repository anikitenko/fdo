export const text = 'Quasar Quill — привіт 👋';
export const openaiEvents = (content = text, reason = 'stop') => [
    {type: 'response.created', response: {id: 'resp_1', created_at: 1, model: 'gpt-5'}},
    {type: 'response.output_item.added', output_index: 0, item: {type: 'message', id: 'msg_1'}},
    {type: 'response.output_text.delta', item_id: 'msg_1', output_index: 0, delta: content},
    {type: 'response.output_item.done', output_index: 0, item: {type: 'message', id: 'msg_1'}},
    {type: reason === 'stop' ? 'response.completed' : 'response.incomplete', response: reason === 'stop' ? {status: 'completed'} : {status: 'incomplete', incomplete_details: {reason: 'max_output_tokens'}}},
];
export const anthropicEvents = (content = text, reason = 'end_turn') => [
    {type: 'message_start', message: {id: 'msg_1', model: 'claude-test', role: 'assistant', usage: {input_tokens: 10}}},
    {type: 'content_block_start', index: 0, content_block: {type: 'text', text: ''}},
    {type: 'content_block_delta', index: 0, delta: {type: 'text_delta', text: content}},
    {type: 'content_block_stop', index: 0},
    {type: 'message_delta', delta: {stop_reason: reason}, usage: {output_tokens: 5}},
    {type: 'message_stop'},
];
export const ollamaEvents = (content = text, reason = 'stop') => [
    {model: 'local-test', created_at: '2026-01-01T00:00:00Z', message: {role: 'assistant', content}, done: false},
    {model: 'local-test', created_at: '2026-01-01T00:00:00Z', message: {role: 'assistant', content: ''}, done: true, done_reason: reason},
];
export function responseFor(events, service = 'openai', fragment = false) {
    const wire = service === 'ollama' ? events.map(JSON.stringify).join('\n') + '\n'
        : events.map(event => `${event.type ? `event: ${event.type}\r\n` : ''}data: ${JSON.stringify(event)}\r\n\r\n`).join('');
    const bytes = new TextEncoder().encode(wire);
    return new Response(new ReadableStream({start(controller) {
        if (fragment) for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
        else controller.enqueue(bytes);
        controller.close();
    }}), {headers: {'content-type': service === 'ollama' ? 'application/x-ndjson' : 'text/event-stream'}});
}
export async function consume(response) {
    const chunks = [];
    for await (const chunk of response.stream) chunks.push(chunk);
    return {chunks, complete: await response.complete()};
}
