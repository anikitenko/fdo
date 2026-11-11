import {randomUUID} from 'node:crypto';

// Heartbeats use a private bootstrap protocol, independent of UI queue traffic.
export function watchPluginWorker(child, onChange, {intervalMs = 10000, timeoutMs = 5000, missedLimit = 3} = {}) {
    let stopped = false, pending = null, deadline = null, missed = 0, unhealthy = false;
    const notify = value => {try { onChange(value); } catch { /* Diagnostics cannot take down the host. */ }};
    const reply = message => {
        if (stopped || !pending || message?.type !== 'HOST_PLUGIN_HEARTBEAT_REPLY_V1' || message.requestId !== pending) return;
        pending = null;
        clearTimeout(deadline); deadline = null;
        missed = 0;
        if (unhealthy) { unhealthy = false; notify({status: 'responsive', missed: 0, checkedAt: Date.now()}); }
    };
    const tick = () => {
        if (stopped || pending) return;
        pending = randomUUID();
        deadline = setTimeout(() => {
            deadline = null; pending = null;
            if (++missed >= missedLimit && !unhealthy) {
                unhealthy = true;
                notify({status: 'unresponsive', missed, checkedAt: Date.now()});
            }
        }, timeoutMs);
        deadline.unref?.();
        try { child.postMessage({message: 'HOST_PLUGIN_HEARTBEAT_V1', content: {requestId: pending}}); }
        catch {
            stop();
            if (!unhealthy) { unhealthy = true; notify({status: 'unresponsive', missed: missedLimit, checkedAt: Date.now()}); }
        }
    };
    const timer = setInterval(tick, intervalMs);
    timer.unref?.();
    function stop() {
        if (stopped) return;
        stopped = true;
        clearInterval(timer); clearTimeout(deadline);
        child.off('message', reply); child.off('exit', stop); child.off('error', stop);
    }
    child.on('message', reply); child.once('exit', stop); child.once('error', stop);
    tick();
    return stop;
}

export function createPluginRestartLimiter() {
    const attempts = new Map();
    return pluginId => {
        const now = Date.now();
        // Expire entries for inactive plugins too.
        for (const [id, times] of attempts) {
            const recent = times.filter(time => now - time < 600000);
            if (recent.length) attempts.set(id, recent); else attempts.delete(id);
        }
        const recent = attempts.get(pluginId) || [];
        if (recent.length >= 3) return false;
        attempts.set(pluginId, [...recent, now]);
        return true;
    };
}
