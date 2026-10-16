export function subscribePluginEvent(event, callback) {
    const bridge = window.electron.plugin;
    const unsubscribe = bridge.on[event](callback);
    // Also supports older preload bridges and the lightweight renderer mocks.
    return typeof unsubscribe === 'function' ? unsubscribe : () => bridge.off[event](callback);
}
