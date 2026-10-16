// Legacy SDK UI_MESSAGE replies do not echo a request ID. All host callers,
// including diagnostics, must serialize requests within the same worker session.
const queues = new Map();
export function enqueuePluginUiBridge(pluginId, sessionId, task) {
    const key = JSON.stringify([String(pluginId || '').trim(), String(sessionId || '').trim()]);
    const previous = queues.get(key) || Promise.resolve();
    const result = previous.then(() => task());
    // Keep the internal tail resolved even when a caller's task rejects.
    const tail = result.then(() => undefined, () => undefined);
    queues.set(key, tail);
    void tail.then(() => {if (queues.get(key) === tail) queues.delete(key);});
    return result;
}
