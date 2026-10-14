/** @jest-environment node */
import {EventEmitter} from 'node:events';
import {screen, shell} from 'electron';
import {focusAssistantOwner, installAssistantWindowPolicy} from '../../src/utils/desktop/assistantWindowPolicy';
import path from 'node:path';
jest.mock('electron', () => ({screen: {getDisplayMatching: jest.fn(() => ({workArea: {x: -1440, y: 0, width: 1440, height: 900}}))}, shell: {openExternal: jest.fn().mockResolvedValue()}}));
function setup() {
    const parent = Object.assign(new EventEmitter(), {getBounds: () => ({x: -1400, y: 40, width: 1060, height: 860}), webContents: Object.assign(new EventEmitter(), {setWindowOpenHandler: jest.fn()})});
    installAssistantWindowPolicy(parent);
    return {parent, handle: parent.webContents.setWindowOpenHandler.mock.calls[0][0]};
}
test('opens only the trusted blank assistant with a modeless, restricted window on the matching monitor', () => {
    const {parent, handle} = setup();
    const result = handle({url: 'about:blank', frameName: 'fdo-ai-assistant'});
    expect(result).toMatchObject({action: 'allow', overrideBrowserWindowOptions: {modal: false, width: 680, height: 900, x: -680, y: 0,
        webPreferences: {nodeIntegration: false, contextIsolation: true, sandbox: true}}});
    expect(result.overrideBrowserWindowOptions).not.toHaveProperty('parent');
    expect(path.isAbsolute(result.overrideBrowserWindowOptions.webPreferences.preload)).toBe(true);
    expect(result.overrideBrowserWindowOptions.webPreferences.preload).toMatch(/assistant-preload\.js$/);
    expect(screen.getDisplayMatching).toHaveBeenCalledWith(parent.getBounds());
    expect(handle({url: 'https://example.com', frameName: 'fdo-ai-assistant'})).toEqual({action: 'deny'});
    expect(shell.openExternal).toHaveBeenCalledWith('https://example.com');
    expect(handle({url: 'file:///private/file', frameName: 'fdo-ai-assistant'})).toEqual({action: 'deny'});
    expect(handle({url: 'about:blank', frameName: 'other-window'})).toEqual({action: 'deny'});
});
test('Show IDE restores and focuses the native owner window', () => {
    const owner = {isDestroyed: () => false, isMinimized: () => true, restore: jest.fn(), show: jest.fn(), focus: jest.fn()};
    expect(focusAssistantOwner(owner)).toEqual({success: true});
    expect(owner.restore).toHaveBeenCalledTimes(1);
    expect(owner.show).toHaveBeenCalledTimes(1);
    expect(owner.focus).toHaveBeenCalledTimes(1);
    expect(focusAssistantOwner(null).success).toBe(false);
    expect(focusAssistantOwner({...owner, isDestroyed: () => true}).success).toBe(false);
});
test('blocks companion navigation and removes parent listeners when a companion closes', () => {
    const {parent} = setup();
    const child = Object.assign(new EventEmitter(), {webContents: new EventEmitter(), isDestroyed: () => false, destroy: jest.fn()});
    parent.webContents.emit('did-create-window', child, {frameName: 'fdo-ai-assistant'});
    const event = {preventDefault: jest.fn()};
    child.webContents.emit('will-navigate', event, 'file:///private/file');
    expect(event.preventDefault).toHaveBeenCalled();
    expect(parent.listenerCount('closed')).toBe(1);
    child.emit('closed');
    expect(parent.listenerCount('closed')).toBe(0);
});
test('closing the IDE destroys its companion', () => {
    const {parent} = setup();
    const child = Object.assign(new EventEmitter(), {webContents: new EventEmitter(), isDestroyed: () => false, destroy: jest.fn()});
    parent.webContents.emit('did-create-window', child, {frameName: 'fdo-ai-assistant'});
    parent.emit('closed');
    expect(child.destroy).toHaveBeenCalledTimes(1);
});
