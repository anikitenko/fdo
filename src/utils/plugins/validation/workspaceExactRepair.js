// A bounded fallback for scoped repairs whose complete-file response overflowed.
// Exact matches are applied atomically against the original source, never against
// partial provider output. The caller validates the reconstructed complete file.
export const WORKSPACE_EXACT_REPAIR_SCHEMA = {
    type: 'object', additionalProperties: false, required: ['edits'],
    properties: {edits: {type: 'array', minItems: 1, maxItems: 16, items: {
        type: 'object', additionalProperties: false, required: ['before', 'after'],
        properties: {before: {type: 'string', minLength: 1}, after: {type: 'string'}},
    }}},
};

export function applyWorkspaceExactRepair(source, response) {
    const fail = (message, details = {}) => { throw Object.assign(new Error(`Exact file repair rejected: ${message}. No edits were applied.`), details); };
    if (typeof response !== 'string' || response.length > 48000) fail('response exceeds its size limit');
    let proposal;
    try { proposal = JSON.parse(response.trim().replace(/^```json\s*\n([\s\S]*)\n```$/i, '$1')); }
    catch { fail('expected a JSON edits object'); }
    if (!proposal || Array.isArray(proposal) || Object.keys(proposal).some(key => key !== 'edits')
        || !Array.isArray(proposal.edits) || !proposal.edits.length || proposal.edits.length > 16) fail('invalid edits object');
    const spans = proposal.edits.map((edit, index) => {
        if (!edit || typeof edit.before !== 'string' || !edit.before || typeof edit.after !== 'string'
            || Object.keys(edit).some(key => !['before', 'after'].includes(key))) fail('invalid replacement');
        const start = source.indexOf(edit.before);
        const matches = [];
        for (let at = start; at >= 0; at = source.indexOf(edit.before, at + 1)) matches.push(at);
        if (matches.length !== 1) {
            const lines = matches.slice(0, 5).map(at => source.slice(0, at).split('\n').length);
            fail(`edit ${index + 1}: before block has ${matches.length} exact matches in the original file${lines.length ? ` (starting at lines ${lines.join(', ')})` : ''}; each before block must match exactly once. ${matches.length ? 'Include surrounding unchanged source to identify a unique occurrence' : 'Copy the before text exactly from the original file, including whitespace and source escaping'}`,
                {code: 'EXACT_REPAIR_MATCH', editIndex: index, matchCount: matches.length});
        }
        if (edit.before === edit.after) fail('replacement must change the source');
        return {start, end: start + edit.before.length, after: edit.after};
    }).sort((a, b) => a.start - b.start);
    if (spans.some((span, index) => index > 0 && spans[index - 1].end > span.start)) fail('replacements overlap');
    let result = source;
    for (const span of spans.reverse()) result = result.slice(0, span.start) + span.after + result.slice(span.end);
    if (result.length > 48000) fail('reconstructed file exceeds its size limit');
    return result;
}

// A correction can select host-issued whole-line anchors instead of copying a
// multiline before block. Anchors belong to this immutable snapshot only.
export function createAnchoredWorkspaceRepair(source) {
    const lines = source.match(/[^\n]*\n|[^\n]+$/g) || [];
    let offset = 0;
    const anchors = lines.map((text, index) => {
        const entry = {id: index + 1, start: offset, end: offset + text.length, text};
        offset = entry.end;
        return entry;
    });
    return {
        responseSchema: {type: 'object', additionalProperties: false, required: ['edits'], properties: {
            edits: {type: 'array', minItems: 1, maxItems: 16, items: {type: 'object', additionalProperties: false,
                required: ['start', 'end', 'after'], properties: {
                    start: {type: 'integer', minimum: 1, maximum: Math.max(1, lines.length)},
                    end: {type: 'integer', minimum: 1, maximum: Math.max(1, lines.length)}, after: {type: 'string'},
                }}},
        }},
        prompt: `ANCHORED EDIT CORRECTION — replaces the before/after response format for this request only.
Return {"edits":[{"start":1,"end":1,"after":"complete replacement lines"}]}. The numbers in this example illustrate the format only; select the actual lines needing repair.
Select inclusive whole-line ranges from the numbered ORIGINAL SNAPSHOT below. start and end must be integers from 1 through ${lines.length}. Use the same number for a one-line edit. Do not return strings, hashes, L prefixes, source text, or numbers taken from diagnostic stack traces. Ranges must not overlap. Preserve unchanged portions of selected lines in after, and preserve meaningful assertions and unrelated behavior. Never include line labels in after. An empty after deletes the selected lines. All edits refer to this snapshot; no edit has been applied. Return the complete intended correction, not just the first previously rejected edit. No new paths, fuzzy matching or additional attempts.
${anchors.map(entry => `${entry.id} | ${entry.text.replace(/\r?\n$/, '')}`).join('\n')}`,
        apply(response) {
            const fail = reason => { throw new Error(`Anchored file repair rejected: ${reason}. No edits were applied.`); };
            if (typeof response !== 'string' || response.length > 48000) fail('response exceeds its size limit');
            let value;
            try { value = JSON.parse(response.trim().replace(/^```json\s*\n([\s\S]*)\n```$/i, '$1')); }
            catch { fail('expected JSON edits'); }
            if (!value || Array.isArray(value) || Object.keys(value).some(key => key !== 'edits')
                || !Array.isArray(value.edits) || !value.edits.length || value.edits.length > 16) fail('invalid edits object');
            const byId = new Map(anchors.map(entry => [entry.id, entry]));
            const spans = value.edits.map(edit => {
                if (!edit || Object.keys(edit).some(key => !['start', 'end', 'after'].includes(key)) || typeof edit.after !== 'string') fail('invalid edit');
                const start = byId.get(edit.start), end = byId.get(edit.end);
                if (!start || !end || start.start > end.start) fail('start/end must be integer line numbers within the original snapshot, with start <= end');
                let after = edit.after;
                if (after && end.text.endsWith('\n') && !after.endsWith('\n')) after += end.text.endsWith('\r\n') ? '\r\n' : '\n';
                if (after === source.slice(start.start, end.end)) fail('edit leaves the selected range unchanged');
                return {start: start.start, end: end.end, after};
            }).sort((a, b) => a.start - b.start);
            if (spans.some((span, index) => index && spans[index - 1].end > span.start)) fail('overlapping ranges');
            let result = source;
            for (const span of spans.reverse()) result = result.slice(0, span.start) + span.after + result.slice(span.end);
            if (result.length > 48000) fail('reconstructed source exceeds its size limit');
            return result;
        },
    };
}
