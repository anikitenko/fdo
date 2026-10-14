// Describe the wire format without retaining prompts, generated text, reasoning,
// tool arguments, arbitrary field names or provider IDs.
const kind = value => value == null ? String(value) : Array.isArray(value) ? 'array' : typeof value;
const fields = ['result', 'response', 'choices', 'delta', 'message', 'content', 'text', 'reasoning', 'reasoning_content', 'finish_reason', 'usage'];
const shape = value => kind(value) !== 'object' ? kind(value) : fields.filter(key => Object.hasOwn(value, key))
    .map(key => `${key}:${kind(value[key])}`).join(',') || 'object';

export function cloudflareStreamDiagnostics(status, think) {
    const started = Date.now();
    const shapes = new Set();
    const counts = {events: 0, choices: 0, answerCharacters: 0, reasoningCharacters: 0, usage: false, done: false, finish: false};
    return {
        counts,
        observe(event, payload) {
            counts.events++;
            if (Array.isArray(payload?.choices)) counts.choices++;
            if (shapes.size < 6) shapes.add(`root(${shape(event)}); payload(${shape(payload)}); choice(${shape(payload?.choices?.[0])}); delta(${shape(payload?.choices?.[0]?.delta)})`);
        },
        summary() {
            return `HTTP ${status}; ${Math.round((Date.now() - started) / 1000)}s; requested thinking: ${think === false ? 'off' : think === true ? 'on' : 'auto'}; ${counts.events} JSON events, ${counts.choices} choice events; `
                + `${counts.answerCharacters} answer characters, ${counts.reasoningCharacters} reasoning characters; `
                + `usage received: ${counts.usage}; finish reason received: ${counts.finish}; [DONE] received: ${counts.done}. `
                + `Event shapes: ${[...shapes].join(' | ') || 'none'}.`;
        },
    };
}
