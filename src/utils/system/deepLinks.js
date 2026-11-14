import semver from 'semver';

// Accept only the documented route. A link cannot choose a server, local path,
// credentials or arbitrary operation. Reject normalization tricks before URL parsing.
export function parseDeepLink(value) {
    if (typeof value !== 'string' || value.length > 512 || !/^fdo-fiddle:\/\/registry\/plugins\/[^/?#]+\/[^/?#]+$/.test(value))
        throw new Error('Unsupported FDO link. Expected a registry plugin and exact release version.');
    const parts = value.slice('fdo-fiddle://registry/plugins/'.length).split('/');
    let id, version;
    try {[id, version] = parts.map(decodeURIComponent);} catch {throw new Error('Invalid FDO link encoding.');}
    if (!/^[a-z0-9][a-z0-9._-]{0,127}$/.test(id) || !semver.valid(version) || semver.valid(version) !== version.split('+')[0] || version.length > 80)
        throw new Error('Invalid registry plugin ID or release version.');
    return {id, version};
}

// Bounded FIFO, serialized dialogs and in-flight deduplication. Readiness is
// explicit so macOS open-url events received before app.whenReady are retained.
export function createDeepLinkQueue({handle, report, onQueued = () => {}, limit = 8}) {
    const pending = new Map();
    let ready = false, running = false;
    async function drain() {
        if (!ready || running) return;
        running = true;
        try {
            while (pending.size) {
                const [key, release] = pending.entries().next().value;
                try {await handle(release);} catch (error) {await report(error);}
                finally {pending.delete(key);}
            }
        } finally {running = false;}
    }
    return {
        enqueue(value) {
            let release;
            try {release = parseDeepLink(value);} catch (error) {void report(error); return;}
            const key = `${release.id}/${release.version}`;
            if (pending.has(key)) return;
            if (pending.size >= limit) {void report(new Error('Too many installation links. Finish the current installation first.')); return;}
            pending.set(key, release);
            onQueued(release, pending.size);
            void drain();
        },
        start() {ready = true; void drain();},
    };
}
