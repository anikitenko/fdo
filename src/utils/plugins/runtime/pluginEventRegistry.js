// Subscription-owned cleanup survives contextBridge callback proxy changes.
// An unknown callback must never remove subscriptions owned by other frames.
export function createPluginEventRegistry(ipc) {
    const registries = new Map();
    const registry = key => {
        if (!registries.has(key)) registries.set(key, new WeakMap());
        return registries.get(key);
    };
    const remove = (key, channel, callback) => {
        const wrappers = registry(key), wrapped = wrappers.get(callback);
        if (!wrapped) return;
        ipc.removeListener(channel, wrapped);
        wrappers.delete(callback);
    };
    const add = (key, channel, callback, projector = value => value) => {
        remove(key, channel, callback);
        const wrappers = registry(key);
        const wrapped = (_event, payload) => callback(projector(payload));
        wrappers.set(callback, wrapped);
        ipc.on(channel, wrapped);
        return () => {
            ipc.removeListener(channel, wrapped);
            if (wrappers.get(callback) === wrapped) wrappers.delete(callback);
        };
    };
    return {add, remove};
}
