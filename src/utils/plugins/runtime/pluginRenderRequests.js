import {randomUUID} from 'node:crypto';

// The installed SDK processes PLUGIN_RENDER synchronously and replies in dispatch
// order. Track every host dispatch, including the post-init safety render, on its
// worker instance so an earlier reply cannot consume a later navigation intent.
const requests = new WeakMap();

export function postPluginRender(child, {replace = false} = {}) {
    const pending = requests.get(child) || [];
    if (pending.length >= 32) throw new Error('Plugin render queue is full.');
    const request = {id: randomUUID(), replace: replace === true, expiresAt: Date.now() + 10000};
    pending.push(request);
    requests.set(child, pending);
    try {
        const envelope = {message: 'PLUGIN_RENDER'};
        child.postMessage({...envelope, data: envelope});
    } catch (error) {
        pending.splice(pending.indexOf(request), 1);
        throw error;
    }
}

export function consumePluginRenderRequest(child) {
    const request = requests.get(child)?.shift();
    if (!request) return {replace: false};
    return {id: request.id, replace: request.replace && request.expiresAt >= Date.now()};
}
