import icons from './fdoAiTrayIcons.json';
import {AiCodingAgentChannels} from '../../../ipc/channels';

// Embedded PNGs keep packaged and development builds identical. The source
// vector lives in fdoAiIdentity; scripts/generate-ai-tray-icons.cjs regenerates these.
export function createAiCodingTray({platform, Tray, Menu, nativeImage}) {
    let tray;
    const focus = window => {
        if (window.isDestroyed()) return;
        if (window.isMinimized()) window.restore();
        window.show();
        window.focus();
        window.webContents.send(AiCodingAgentChannels.OPEN_ACTIVITY);
    };
    return {
        update(entries) {
            if (!entries.length) {
                tray?.destroy();
                tray = undefined;
                return;
            }
            if (!tray) {
                const image = nativeImage.createEmpty();
                for (const representation of icons[platform === 'darwin' ? 'template' : 'color']) {
                    image.addRepresentation(representation);
                }
                if (platform === 'darwin') image.setTemplateImage(true);
                tray = new Tray(image);
            }
            const status = entries.length === 1 ? 'AI coding agent is working' : `${entries.length} AI coding agents are working`;
            const details = entry => [...new Set([entry.progress?.stage, entry.progress?.progress, entry.progress?.estimate].filter(Boolean))];
            const escapeLabel = text => text.replace(/&/g, '&&');
            const summary = entries.length === 1 ? details(entries[0][1]).slice(0, 2).join(' · ') : '';
            tray.setToolTip(`FDO — ${summary || status}`.slice(0, 127));
            const menu = Menu.buildFromTemplate([
                {label: status, enabled: false},
                {type: 'separator'},
                ...entries.flatMap(([window, entry]) => [
                    ...(entries.length > 1 && details(entry).length ? [{label: escapeLabel(entry.title), enabled: false}] : []),
                    ...details(entry).map(text => ({label: escapeLabel(text), enabled: false})),
                    {
                        label: entries.length === 1 ? 'Open coding agent' : `Open ${entry.title.replace(/&/g, '&&')}`,
                        click: () => focus(window),
                    }]),
            ]);
            // macOS opens its native menu on click. Windows/Linux also support
            // activation; the menu remains available where Linux activation varies.
            tray.removeAllListeners('click');
            if (platform !== 'darwin') tray.on('click', () => focus(entries[entries.length - 1][0]));
            tray.setContextMenu(menu);
        },
    };
}
