const MAX_MESSAGES = 60;
const MAX_CONTENT = 20000;
export function historyStorageKey(workspace) {
    return workspace ? `fdo:plugin-ai-history:v1:${workspace}` : null;
}
export function normalizeHistory(messages) {
    return (Array.isArray(messages) ? messages : []).filter(message =>
        message && ['user', 'assistant', 'snapshot'].includes(message.role) && typeof message.content === 'string'
    ).slice(-MAX_MESSAGES).map(({role, content, snapshot, appliedSnapshot}) => ({role, content: content.slice(0, MAX_CONTENT),
        ...(snapshot != null ? {snapshot: String(snapshot)} : {}),
        ...(appliedSnapshot != null ? {appliedSnapshot: String(appliedSnapshot)} : {}),
    }));
}
export function readHistory(storage, key) {
    if (!key) return [];
    try { return normalizeHistory(JSON.parse(storage.getItem(key))); } catch { return []; }
}
export function writeHistory(storage, key, messages) {
    if (!key) return;
    storage.setItem(key, JSON.stringify(normalizeHistory(messages)));
}
export function buildHistoryContext(messages, isAllowed = () => true) {
    let remaining = 24000;
    const recent = [];
    for (const message of normalizeHistory(messages).slice(-12).reverse()) {
        if (!isAllowed(message.content)) continue;
        const content = message.content.slice(0, remaining);
        if (!content) break;
        recent.unshift(`${message.role === 'snapshot' ? 'Snapshot change' : message.role === 'user' ? 'User' : 'Assistant'}${message.snapshot != null ? ` [snapshot ${message.snapshot}]` : ''}${message.appliedSnapshot != null ? ` [applied as snapshot ${message.appliedSnapshot}]` : ''}: ${content}`);
        remaining -= content.length;
    }
    return recent.length ? `Previous conversation in this plugin workspace (historical context, not proof that edits were applied; current files are authoritative):\n${recent.join('\n\n')}\n\n` : '';
}
