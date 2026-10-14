// Skills are explicit completions, never variable expansion. Literal shell
// syntax, quoted strings, and Markdown code stay ordinary prompt text.
export function detectCodexSkillMention(text = '', cursorIndex = text.length) {
    const cursor = Math.max(0, Math.min(cursorIndex, text.length));
    const prefix = text.slice(0, cursor);
    const next = text[cursor] || '';
    if (/[A-Za-z0-9_-]/.test(next) || ['{', '(', '<', '$', '\\'].includes(next)) return null;
    let quote = '', code = '';
    for (let index = 0; index < prefix.length; index++) {
        if (prefix[index] === '\\') {index++; continue;}
        if (quote) {if (prefix[index] === quote) quote = ''; continue;}
        const marker = /^(?:`+|~{3,})/.exec(prefix.slice(index))?.[0];
        if (marker) {
            if (!code) code = marker;
            else if (marker === code) code = '';
            index += marker.length - 1; continue;
        }
        if (code) continue;
        if ((prefix[index] === '"' || prefix[index] === "'") && (index === 0 || /[\s([{]/.test(prefix[index - 1]))) quote = prefix[index];
    }
    if (quote || code) return null;
    const match = /(^|[\s([{])\$([a-z0-9-]*)$/.exec(prefix);
    // JavaScript's $ anchor also matches before a final newline. A newline
    // finishes the token; never offer a completion on the next line.
    if (match && match.index + match[0].length !== prefix.length) return null;
    if (match && /^\d/.test(match[2])) return null;
    return match ? {kind: 'skill', query: match[2], start: cursor - match[2].length - 1, end: cursor} : null;
}

export function getCodexSkillMentionItems(skills, assistant, query = '', limit = 8) {
    if (assistant?.provider !== 'codex-cli') return [];
    return (skills || []).filter(skill => skill.enabled && skill.assistantIds?.includes(assistant.id)
        && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(skill.name) && skill.name.startsWith(query))
        .sort((left, right) => left.name.localeCompare(right.name)).slice(0, limit)
        .map(skill => ({type: 'skill', token: '$' + skill.name, insertText: '$' + skill.name, title: '$' + skill.name, subtitle: skill.description}));
}

export function applyCodexSkillMention(text, mention, insertText, suggestions) {
    if (mention?.kind !== 'skill' || !suggestions.some(item => item.insertText === insertText)) return {value: text, cursorIndex: mention?.end ?? text.length};
    const suffix = text.slice(mention.end);
    const space = !suffix || !/^\s/.test(suffix) ? ' ' : '';
    return {value: text.slice(0, mention.start) + insertText + space + suffix, cursorIndex: mention.start + insertText.length + space.length};
}
