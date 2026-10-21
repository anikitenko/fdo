import {isTrustedParentPluginEvent, isValidPluginUiResponseEvent} from './pluginRenderSecurity';

// One dispatcher per iframe, rather than one window listener per pending request.
export function createPluginRequestBridge(target = window) {
    const pending = new Map();
    const prefix = `ui-message-${Date.now()}-${Math.random().toString(36).slice(2)}-`;
    let sequence = 0;
    let disposed = false;
    const cancelled = () => ({success: false, error: 'The plugin view was disposed.'});
    const reset = () => {
        for (const resolve of pending.values()) resolve(cancelled());
        pending.clear();
    };
    const handleResponse = event => {
        if (!isTrustedParentPluginEvent(event, target.parent)) return;
        const requestId = event.data.requestId;
        const resolve = pending.get(requestId);
        if (!resolve || !isValidPluginUiResponseEvent(event.data, requestId)) return;
        if (typeof resolve !== 'function') {
            pending.delete(requestId);
            return;
        }
        pending.delete(requestId);
        resolve(event.data.error ? {success: false, error: event.data.error} : event.data.content);
    };
    target.addEventListener('message', handleResponse);
    const request = (type, data) => {
        if (disposed) return Promise.resolve(cancelled());
        return new Promise((resolve, reject) => {
            const requestId = prefix + ++sequence;
            const message = type === 'UI_MESSAGE' && data && typeof data === 'object'
                ? {
                    handler: typeof data.handler === 'string' && data.handler.trim() ? data.handler.trim() : 'requestPrivilegedAction',
                    content: Object.prototype.hasOwnProperty.call(data, 'content') ? data.content : data,
                }
                : {handler: type, content: data};
            // Register before posting: even a synchronous host reply must be routable.
            pending.set(requestId, resolve);
            try {target.parent.postMessage({type: 'UI_MESSAGE_REQUEST', requestId, message}, '*');}
            catch (error) {pending.delete(requestId); reject(error);}
        });
    };
    return {
        request,
        reset,
        dispose() {
            if (disposed) return;
            disposed = true;
            target.removeEventListener('message', handleResponse);
            reset();
        },
    };
}
