// Self-contained because PluginPage serializes this into the sandboxed view module.
export function waitForPluginAssets(doc = document, target = window) {
    const cleanups = new Set();
    const wait = (subscribe, timeoutMs) => new Promise(resolve => {
        let timer;
        let unsubscribe = () => {};
        const finish = () => {
            target.clearTimeout(timer);
            unsubscribe();
            cleanups.delete(finish);
            resolve();
        };
        cleanups.add(finish);
        unsubscribe = subscribe(finish);
        timer = target.setTimeout(finish, timeoutMs);
    });

    const windowReady = doc.readyState === 'complete' ? Promise.resolve() : wait(finish => {
        target.addEventListener('load', finish, {once: true});
        return () => target.removeEventListener('load', finish);
    }, 1800);

    const pending = new Set(Array.from(doc.querySelectorAll('link[rel="stylesheet"]'))
        .filter(link => !link.sheet));
    // A sheet object exists once CSS has loaded, including cross-origin sheets
    // whose cssRules cannot be read. No rule access or polling is necessary.
    const stylesReady = pending.size === 0 ? Promise.resolve() : wait(finish => {
        const settled = event => {
            pending.delete(event.currentTarget);
            if (pending.size === 0) finish();
        };
        const links = Array.from(pending);
        links.forEach(link => {
            link.addEventListener('load', settled);
            link.addEventListener('error', settled);
        });
        return () => links.forEach(link => {
            link.removeEventListener('load', settled);
            link.removeEventListener('error', settled);
        });
    }, 1400);

    return {
        ready: Promise.all([windowReady, stylesReady]),
        dispose() {
            for (const finish of cleanups) finish();
        },
    };
}
