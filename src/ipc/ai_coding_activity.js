import {app, BrowserWindow, ipcMain, Tray, Menu, nativeImage} from 'electron';
import {AiCodingAgentChannels} from './channels';
import {createOsCodingActivity} from '../utils/ai/assistant/osCodingActivity';
import {createAiCodingTray} from '../utils/ai/assistant/aiCodingTray';

export function registerAiCodingActivityHandlers({rendererUrl}) {
    const rendererDocument = new URL(rendererUrl);
    rendererDocument.hash = '';
    rendererDocument.search = '';
    const tray = createAiCodingTray({platform: process.platform, Tray, Menu, nativeImage});
    const activity = createOsCodingActivity({platform: process.platform, dock: app.dock, tray});
    ipcMain.on(AiCodingAgentChannels.SET_ACTIVITY, (event, active, progress) => {
        if (typeof active !== 'boolean' || event.senderFrame !== event.sender.mainFrame) return;
        // The editor can occupy the main window (including live tests) or its
        // own window. Trust the application document, not a window singleton.
        let senderUrl;
        try { senderUrl = new URL(event.sender.getURL()); } catch { return; }
        if (active && senderUrl.hash.split('?')[0] !== '#/editor') return;
        senderUrl.hash = '';
        senderUrl.search = '';
        if (senderUrl.href !== rendererDocument.href) return;
        const window = BrowserWindow.fromWebContents(event.sender);
        if (!window) return;
        if (active && progress && typeof progress === 'object' && !Array.isArray(progress)) {
            const clean = value => typeof value === 'string' ? value.replace(/[\x00-\x1f\x7f]/g, ' ').trim().slice(0, 180) : '';
            activity.set(window, active, {stage: clean(progress.stage), progress: clean(progress.progress), estimate: clean(progress.estimate)});
        } else activity.set(window, active);
    });
    app.once('before-quit', () => activity.dispose());
}
