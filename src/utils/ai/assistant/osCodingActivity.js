const SUFFIX = ' — AI working';
const safely = action => { try { return action(); } catch { return undefined; } };

// Own only our activity decoration. No percentages: generation can expand and
// a completed provider response still has to pass validation and application.
export function createOsCodingActivity({platform, dock, tray}) {
    const running = new Map();
    let previousBadge = '', ownedBadge = '';
    const updateTray = () => safely(() => tray?.update([...running.entries()]));
    const updateBadge = () => {
        if (platform !== 'darwin' || !dock) return;
        if (running.size) {
            ownedBadge = running.size > 1 ? `AI ${running.size}` : 'AI';
            safely(() => dock.setBadge(ownedBadge));
        } else {
            if (safely(() => dock.getBadge()) === ownedBadge) safely(() => dock.setBadge(previousBadge));
            ownedBadge = '';
        }
    };
    const clear = window => {
        const entry = running.get(window);
        if (!entry) return;
        running.delete(window);
        entry.listeners.forEach(([target, name, listener]) => target.removeListener(name, listener));
        if (!window.isDestroyed()) {
            if (platform === 'win32') safely(() => window.setProgressBar(-1));
            if (safely(() => window.getTitle()) === entry.title + SUFFIX) safely(() => window.setTitle(entry.title));
        }
        updateBadge();
        updateTray();
    };
    return {
        set(window, active, progress) {
            if (!active) { clear(window); return; }
            if (!window || window.isDestroyed()) return;
            if (running.has(window)) {
                const entry = running.get(window);
                if (progress && JSON.stringify(entry.progress) !== JSON.stringify(progress)) {
                    entry.progress = progress;
                    updateTray();
                }
                return;
            }
            if (!running.size && platform === 'darwin') previousBadge = safely(() => dock?.getBadge()) || '';
            const entry = {title: window.getTitle(), listeners: [], progress};
            running.set(window, entry);
            const listen = (target, name, listener) => {
                target.on(name, listener);
                entry.listeners.push([target, name, listener]);
            };
            listen(window, 'page-title-updated', (event, title) => {
                event.preventDefault();
                entry.title = title;
                safely(() => window.setTitle(title + SUFFIX));
                updateTray();
            });
            listen(window, 'closed', () => clear(window));
            listen(window.webContents, 'destroyed', () => clear(window));
            listen(window.webContents, 'render-process-gone', () => clear(window));
            listen(window.webContents, 'did-start-navigation', (_event, _url, inPlace, mainFrame) => {
                if (mainFrame && !inPlace) clear(window);
            });
            safely(() => window.setTitle(entry.title + SUFFIX));
            if (platform === 'win32') safely(() => window.setProgressBar(2, {mode: 'indeterminate'}));
            updateBadge();
            updateTray();
        },
        dispose() { [...running.keys()].forEach(clear); },
    };
}
