jest.mock('electron', () => ({app: {once: jest.fn()}, BrowserWindow: {fromWebContents: jest.fn()}, ipcMain: {on: jest.fn()}}));
jest.mock('../../src/utils/ai/assistant/osCodingActivity', () => ({createOsCodingActivity: jest.fn()}));
import {app, BrowserWindow, ipcMain} from 'electron';
import {createOsCodingActivity} from '../../src/utils/ai/assistant/osCodingActivity';
import {registerAiCodingActivityHandlers} from '../../src/ipc/ai_coding_activity';
import {AiCodingAgentChannels} from '../../src/ipc/channels';

test('accepts boolean activity only from the editor main frame and disposes on exit', () => {
    const manager = {set: jest.fn(), dispose: jest.fn()};
    createOsCodingActivity.mockReturnValue(manager);
    const window = {}, mainFrame = {}, sender = {mainFrame,
        getURL: jest.fn(() => 'file:///app/index.html#/editor?data=test')};
    BrowserWindow.fromWebContents.mockReturnValue(window);
    registerAiCodingActivityHandlers({rendererUrl: 'file:///app/index.html'});
    const handler = ipcMain.on.mock.calls.find(([channel]) => channel === AiCodingAgentChannels.SET_ACTIVITY)[1];
    handler({sender, senderFrame: mainFrame}, true);
    expect(manager.set).toHaveBeenCalledWith(window, true);
    handler({sender, senderFrame: {}}, true);
    handler({sender, senderFrame: mainFrame}, 'true');
    sender.getURL.mockReturnValue('file:///other/index.html#/editor');
    handler({sender, senderFrame: mainFrame}, true);
    sender.getURL.mockReturnValue('https://example.com/index.html#/editor');
    handler({sender, senderFrame: mainFrame}, true);
    sender.getURL.mockReturnValue('file:///app/index.html#/home');
    handler({sender, senderFrame: mainFrame}, true);
    expect(manager.set).toHaveBeenCalledTimes(1);
    // Cleanup remains allowed when the editor route has just unmounted.
    handler({sender, senderFrame: mainFrame}, false);
    expect(manager.set).toHaveBeenLastCalledWith(window, false);
    const separateEditor = {};
    BrowserWindow.fromWebContents.mockReturnValue(separateEditor);
    sender.getURL.mockReturnValue('file:///app/index.html#/editor');
    handler({sender, senderFrame: mainFrame}, true);
    expect(manager.set).toHaveBeenLastCalledWith(separateEditor, true);
    handler({sender, senderFrame: mainFrame}, true, {stage: 'Running\ntests', progress: 'x'.repeat(500), estimate: 42, content: 'must not cross IPC'});
    expect(manager.set).toHaveBeenLastCalledWith(separateEditor, true, {stage: 'Running tests', progress: 'x'.repeat(180), estimate: ''});
    const count = manager.set.mock.calls.length;
    handler({sender, senderFrame: {}}, true, {stage: 'Untrusted frame'});
    expect(manager.set).toHaveBeenCalledTimes(count);
    app.once.mock.calls.find(([name]) => name === 'before-quit')[1]();
    expect(manager.dispose).toHaveBeenCalled();
});
