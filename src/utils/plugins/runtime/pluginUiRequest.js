import {enqueuePluginUiBridge} from './pluginUiMessageQueue';

/** Single transport implementation for diagnostics and application UI calls. */
export function requestPluginUiMessage(child, pluginId, sessionId, content, options = {}) {
    return enqueuePluginUiBridge(pluginId, sessionId, ({signal}) => new Promise(resolve => {
        let settled = false;
        const finish = value => {
            if (settled) return;
            settled = true;
            child.off('message', reply);
            child.off('exit', disconnected);
            child.off('error', disconnected);
            signal.removeEventListener('abort', cancelled);
            resolve(value);
        };
        const cancelled = () => finish({ok: false, code: 'PLUGIN_BACKEND_CANCELLED', error: 'Plugin request cancelled.'});
        const disconnected = () => finish({ok: false, code: 'PLUGIN_BACKEND_UNAVAILABLE', error: 'Plugin worker disconnected.'});
        const reply = message => {
            if (message?.type !== 'UI_MESSAGE') return;
            if (options.isCurrent && !options.isCurrent()) {
                finish({ok: false, code: 'PLUGIN_BACKEND_STALE_SESSION', error: 'Plugin session changed.'});
            } else finish(message.response);
        };
        if (signal.aborted || (options.isCurrent && !options.isCurrent())) { cancelled(); return; }
        child.on('message', reply);
        child.once('exit', disconnected);
        child.once('error', disconnected);
        signal.addEventListener('abort', cancelled, {once: true});
        try { child.postMessage({message: 'UI_MESSAGE', content}); }
        catch { disconnected(); }
    }), options);
}


export function postPluginMessage(child, message) {
    try { child.postMessage(message); return true; }
    catch { return false; }
}
