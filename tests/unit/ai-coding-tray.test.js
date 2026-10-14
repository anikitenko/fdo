import {EventEmitter} from 'node:events';
import {createAiCodingTray} from '../../src/utils/ai/assistant/aiCodingTray';
import {AiCodingAgentChannels} from '../../src/ipc/channels';

test.each(['darwin', 'win32', 'linux'])('%s tray uses the shared logo and opens active editors', platform => {
    const nativeTray = new EventEmitter();
    Object.assign(nativeTray, {setToolTip: jest.fn(), setContextMenu: jest.fn(), destroy: jest.fn()});
    const Tray = jest.fn(() => nativeTray);
    const image = {addRepresentation: jest.fn(), setTemplateImage: jest.fn()};
    const Menu = {buildFromTemplate: jest.fn(items => items)};
    const controller = createAiCodingTray({platform, Tray, Menu, nativeImage: {createEmpty: () => image}});
    const window = {isDestroyed: jest.fn(() => false), isMinimized: () => true,
        restore: jest.fn(), show: jest.fn(), focus: jest.fn(), webContents: {send: jest.fn()}};
    controller.update([[window, {title: 'Editor'}]]);
    expect(Tray).toHaveBeenCalledWith(image);
    expect(image.addRepresentation.mock.calls.map(([rep]) => rep.scaleFactor)).toEqual([1, 2, 3]);
    expect(image.setTemplateImage).toHaveBeenCalledTimes(platform === 'darwin' ? 1 : 0);
    nativeTray.setContextMenu.mock.calls[0][0][2].click();
    expect(window.restore).toHaveBeenCalledTimes(1);
    expect(window.focus).toHaveBeenCalledTimes(1);
    expect(window.webContents.send).toHaveBeenCalledWith(AiCodingAgentChannels.OPEN_ACTIVITY);
    controller.update([[window, {title: 'Editor'}], [window, {title: 'Tools'}]]);
    expect(Tray).toHaveBeenCalledTimes(1);
    expect(nativeTray.setToolTip).toHaveBeenLastCalledWith('FDO — 2 AI coding agents are working');
    if (platform !== 'darwin') {
        nativeTray.emit('click');
        expect(window.focus).toHaveBeenCalledTimes(2);
    }
    window.isDestroyed.mockReturnValue(true);
    const count = window.focus.mock.calls.length;
    nativeTray.setContextMenu.mock.calls[1][0][2].click();
    expect(window.focus).toHaveBeenCalledTimes(count);
    controller.update([]);
    controller.update([]);
    expect(nativeTray.destroy).toHaveBeenCalledTimes(1);
    controller.update([[window, {title: 'New run'}]]);
    expect(Tray).toHaveBeenCalledTimes(2);
});

test.each(['darwin', 'win32', 'linux'])('%s tray shows phase, file progress and timing', platform => {
    const nativeTray = new EventEmitter();
    Object.assign(nativeTray, {setToolTip: jest.fn(), setContextMenu: jest.fn(), destroy: jest.fn()});
    const controller = createAiCodingTray({platform, Tray: jest.fn(() => nativeTray), Menu: {buildFromTemplate: items => items},
        nativeImage: {createEmpty: () => ({addRepresentation() {}, setTemplateImage() {}})}});
    const window = {isDestroyed: () => false};
    controller.update([[window, {title: 'Editor', progress: {stage: 'Generating /a&b.ts', progress: '3 of 8 files', estimate: 'Timing is still unpredictable'}}]]);
    const items = nativeTray.setContextMenu.mock.calls[0][0];
    expect(items.map(item => item.label)).toEqual(expect.arrayContaining(['Generating /a&&b.ts', '3 of 8 files', 'Timing is still unpredictable', 'Open coding agent']));
    expect(items.find(item => item.label === '3 of 8 files').enabled).toBe(false);
    expect(nativeTray.setToolTip).toHaveBeenLastCalledWith('FDO — Generating /a&b.ts · 3 of 8 files');
    controller.update([[window, {title: 'Editor', progress: {stage: 'Running tests'}}]]);
    expect(nativeTray.setContextMenu.mock.calls[1][0].map(item => item.label)).not.toContain('3 of 8 files');
});
