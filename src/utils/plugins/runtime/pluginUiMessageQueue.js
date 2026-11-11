// Legacy replies have no request ID. A timed-out dispatch poisons its session;
// never let its late reply satisfy another request. Restart establishes a new key.
const queues = new Map();
const keyFor = (pluginId, sessionId) => JSON.stringify([String(pluginId || '').trim(), String(sessionId || '').trim()]);
const failure = (code, error) => ({ok: false, code, error});

export function cancelPluginUiBridge(pluginId, sessionId) {
    const key = keyFor(pluginId, sessionId);
    const state = queues.get(key);
    if (!state) return;
    state.closed = true;
    for (const entry of [...state.entries]) entry.finish(failure('PLUGIN_BACKEND_CANCELLED', 'Plugin session ended.'));
    queues.delete(key);
}

export function enqueuePluginUiBridge(pluginId, sessionId, task, options = {}) {
    const key = keyFor(pluginId, sessionId);
    let state = queues.get(key);
    if (!state) { state = {entries: [], active: null, closed: false}; queues.set(key, state); }
    if (state.closed) return Promise.resolve(failure('PLUGIN_BACKEND_SESSION_EXPIRED', 'Restart the plugin after a timed-out request.'));
    if (state.entries.length >= 32) return Promise.resolve(failure('PLUGIN_BACKEND_BUSY', 'Plugin request queue is full. Try again later.'));
    const budget = Number.isFinite(options.timeoutMs) ? Math.max(1, Math.min(options.timeoutMs, 60000)) : 15000;
    return new Promise((resolve, reject) => {
        const controller = new AbortController();
        let settled = false;
        const entry = {controller, deadline: Date.now() + budget, finish(value, error) {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            const active = state.active === entry;
            state.entries = state.entries.filter(item => item !== entry);
            if (active) state.active = null;
            controller.abort(); // Detach request listeners on every completion path.
            if (error) reject(error); else resolve(value);
            if (!state.closed) schedule();
        }};
        const timer = setTimeout(() => {
            if (state.active === entry) {
                state.closed = true;
                entry.finish(failure('PLUGIN_BACKEND_TIMEOUT', 'Plugin request timed out. Restart the plugin before retrying.'));
                for (const queued of [...state.entries]) queued.finish(failure('PLUGIN_BACKEND_SESSION_EXPIRED', 'An earlier request timed out. Restart the plugin.'));
            } else entry.finish(failure('PLUGIN_BACKEND_QUEUE_TIMEOUT', 'Plugin request expired while waiting in the queue.'));
        }, budget);
        state.entries.push(entry);
        function schedule() {
            if (state.closed || state.active) return;
            const next = state.entries[0];
            if (!next) {
                if (queues.get(key) === state) queues.delete(key);
                return;
            }
            // Each entry starts its own task, never the scheduler's captured task.
            next.start();
        }
        entry.start = () => {
            if (settled || state.closed) return;
            if (Date.now() >= entry.deadline) { entry.finish(failure('PLUGIN_BACKEND_QUEUE_TIMEOUT', 'Plugin request expired in the queue.')); return; }
            state.active = entry;
            let result;
            try {
                if (controller.signal.aborted) return;
                result = task({signal: controller.signal, remainingMs: Math.max(1, entry.deadline - Date.now())});
            } catch (error) { entry.finish(undefined, error); return; }
            Promise.resolve(result).then(value => {
                if (value?.code === 'PLUGIN_BACKEND_TIMEOUT' && !settled) {
                    state.closed = true;
                    entry.finish(value);
                    for (const queued of [...state.entries]) queued.finish(failure('PLUGIN_BACKEND_SESSION_EXPIRED', 'Restart the plugin after a timed-out request.'));
                } else entry.finish(value);
            }, error => entry.finish(undefined, error));
        };
        // Start on the next microtask, preserving the original queue API.
        queueMicrotask(schedule);
    });
}
