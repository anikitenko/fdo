// Self-contained: serialized into the iframe module. One view owns its helpers
// and registrations, so replacing the view releases its callback closures.
export function installPluginGlobalEvents(target = window) {
    const listeners = new Map();
    const previousAdd = target.addGlobalEventListener;
    const previousRemove = target.removeGlobalEventListener;
    let disposed = false;
    const add = (type, callback) => {
        if (disposed || callback == null) return () => {};
        if (typeof callback !== 'function' && typeof callback !== 'object') {
            throw new TypeError('addGlobalEventListener requires an event listener.');
        }
        const eventType = String(type);
        const callbacks = listeners.get(eventType) || new Map();
        if (callbacks.has(callback)) return callbacks.get(callback);
        let active = true;
        const listener = event => {
            if (!active || disposed) return;
            if (typeof callback === 'function') callback.call(target, event);
            else callback.handleEvent(event);
        };
        const unsubscribe = () => {
            if (!active) return;
            active = false;
            target.removeEventListener(eventType, listener);
            if (callbacks.get(callback) === unsubscribe) callbacks.delete(callback);
            if (!callbacks.size && listeners.get(eventType) === callbacks) listeners.delete(eventType);
        };
        target.addEventListener(eventType, listener);
        callbacks.set(callback, unsubscribe);listeners.set(eventType, callbacks);
        return unsubscribe;
    };
    const remove = (type, callback) => {
        if (disposed) return;
        const eventType = String(type);
        const unsubscribe = listeners.get(eventType)?.get(callback);
        if (unsubscribe) unsubscribe();
        // Preserve helper removal of a listener registered through the native API.
        else target.removeEventListener(eventType, callback);
    };
    target.addGlobalEventListener = add;
    target.removeGlobalEventListener = remove;
    return {
        dispose() {
            if (disposed) return;
            disposed = true;
            for (const callbacks of [...listeners.values()]) for (const unsubscribe of [...callbacks.values()]) unsubscribe();
            listeners.clear();
            if (target.addGlobalEventListener === add) {
                if (previousAdd === undefined) delete target.addGlobalEventListener;
                else target.addGlobalEventListener = previousAdd;
            }
            if (target.removeGlobalEventListener === remove) {
                if (previousRemove === undefined) delete target.removeGlobalEventListener;
                else target.removeGlobalEventListener = previousRemove;
            }
        },
    };
}
