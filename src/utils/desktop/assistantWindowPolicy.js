import {screen, shell} from 'electron';
import path from 'node:path';

export function focusAssistantOwner(owner) {
    if (!owner || owner.isDestroyed()) return {success: false, error: 'The IDE window is no longer available.'};
    if (owner.isMinimized()) owner.restore();
    owner.show();
    owner.focus();
    return {success: true};
}

// Only FDO's trusted, blank assistant surface may open as an editor companion.
export function installAssistantWindowPolicy(parent) {
    parent.webContents.setWindowOpenHandler(({url, frameName}) => {
        if (url === 'about:blank' && frameName === 'fdo-ai-assistant') {
            const bounds = parent.getBounds();
            const area = screen.getDisplayMatching(bounds).workArea;
            const width = Math.min(680, area.width);
            const height = Math.min(900, area.height);
            return {action: 'allow', overrideBrowserWindowOptions: {
                // A native child stays above its parent on macOS. Keep this an
                // independent window; owner closure is handled below.
                modal: false, title: 'AI Coding Assistant · FDO', width, height,
                minWidth: Math.min(480, width), minHeight: Math.min(500, height),
                x: Math.max(area.x, Math.min(bounds.x + bounds.width + 8, area.x + area.width - width)),
                y: Math.max(area.y, Math.min(bounds.y, area.y + area.height - height)),
                autoHideMenuBar: true,
                webPreferences: {nodeIntegration: false, contextIsolation: true, sandbox: true,
                    preload: path.join(__dirname, 'assistant-preload.js')},
            }};
        }
        if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
        return {action: 'deny'};
    });
    parent.webContents.on('did-create-window', (child, details) => {
        if (details.frameName !== 'fdo-ai-assistant') return;
        child.webContents.on('will-navigate', (event, url) => {
            if (url !== 'about:blank') {
                event.preventDefault();
                if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
            }
        });
        const closeChild = () => {if (!child.isDestroyed()) child.destroy();};
        parent.once('closed', closeChild);
        child.once('closed', () => parent.removeListener('closed', closeChild));
    });
}
