import {EventEmitter} from 'node:events';
import {createOsCodingActivity} from '../../src/utils/ai/assistant/osCodingActivity';

const makeWindow = () => {
    const window = new EventEmitter();
    window.webContents = new EventEmitter();
    let title = 'Plugin editor';
    window.isDestroyed = jest.fn(() => false);
    window.getTitle = () => title;
    window.setTitle = jest.fn(value => { title = value; });
    window.setProgressBar = jest.fn();
    return window;
};
const makeDock = () => {
    let badge = '3';
    return {getBadge: () => badge, setBadge: jest.fn(value => { badge = value; })};
};

test('macOS keeps its badge until the last active window finishes and restores the previous badge', () => {
    const dock = makeDock();
    const activity = createOsCodingActivity({platform: 'darwin', dock});
    const first = makeWindow(), second = makeWindow();
    activity.set(first, true);
    expect(dock.getBadge()).toBe('AI');
    activity.set(first, true);
    expect(dock.setBadge).toHaveBeenCalledTimes(1);
    activity.set(second, true);
    expect(dock.getBadge()).toBe('AI 2');
    activity.set(first, false);
    expect(dock.getBadge()).toBe('AI');
    activity.set(second, false);
    expect(dock.getBadge()).toBe('3');
    expect(first.getTitle()).toBe('Plugin editor');
    expect(first.setProgressBar).not.toHaveBeenCalled();
});

test('Windows displays indeterminate taskbar activity and clears it', () => {
    const window = makeWindow();
    const activity = createOsCodingActivity({platform: 'win32'});
    activity.set(window, true);
    expect(window.setProgressBar).toHaveBeenLastCalledWith(2, {mode: 'indeterminate'});
    expect(window.getTitle()).toBe('Plugin editor — AI working');
    activity.set(window, false);
    expect(window.setProgressBar).toHaveBeenLastCalledWith(-1);
});

test.each(['closed', 'destroyed', 'render-process-gone', 'navigation'])('cleans up on %s without leaving a stale Dock badge', event => {
    const window = makeWindow(), dock = makeDock();
    const tray = {update: jest.fn()};
    const activity = createOsCodingActivity({platform: 'darwin', dock, tray});
    activity.set(window, true);
    expect(tray.update.mock.calls[0][0][0][0]).toBe(window);
    if (event === 'closed') { window.isDestroyed.mockReturnValue(true); window.emit('closed'); }
    else if (event === 'navigation') window.webContents.emit('did-start-navigation', {}, 'file:///index.html', false, true);
    else window.webContents.emit(event);
    expect(dock.getBadge()).toBe('3');
    expect(tray.update).toHaveBeenLastCalledWith([]);
    expect(window.listenerCount('page-title-updated')).toBe(0);
    expect(window.webContents.listenerCount('render-process-gone')).toBe(0);
});

test('Linux title follows document title changes and restores the latest title', () => {
    const window = makeWindow();
    const activity = createOsCodingActivity({platform: 'linux'});
    activity.set(window, true);
    const event = {preventDefault: jest.fn()};
    window.emit('page-title-updated', event, 'Workbench');
    expect(event.preventDefault).toHaveBeenCalled();
    expect(window.getTitle()).toBe('Workbench — AI working');
    window.webContents.emit('did-start-navigation', {}, 'file:///iframe.html', false, false);
    expect(window.getTitle()).toBe('Workbench — AI working');
    activity.dispose();
    expect(window.getTitle()).toBe('Workbench');
    expect(window.setProgressBar).not.toHaveBeenCalled();
});

test('does not replace a badge changed by another feature, and tolerates unavailable OS APIs', () => {
    const window = makeWindow(), dock = makeDock();
    const activity = createOsCodingActivity({platform: 'darwin', dock});
    activity.set(window, true);
    dock.setBadge('5');
    activity.dispose();
    expect(dock.getBadge()).toBe('5');
    dock.setBadge = () => { throw new Error('Unavailable'); };
    expect(() => { activity.set(window, true); activity.dispose(); }).not.toThrow();
});

test('updates tray progress without recreating listeners or taskbar activity', () => {
    const window = makeWindow(), tray = {update: jest.fn()};
    const activity = createOsCodingActivity({platform: 'win32', tray});
    activity.set(window, true);
    const progress = {stage: 'Generating /render.tsx', progress: '3 of 8 files', estimate: 'Timing is still unpredictable'};
    activity.set(window, true, progress);
    activity.set(window, true, {...progress});
    expect(tray.update).toHaveBeenCalledTimes(2);
    expect(tray.update.mock.calls[1][0][0][1].progress).toEqual(progress);
    expect(window.listenerCount('closed')).toBe(1);
    expect(window.setProgressBar).toHaveBeenCalledTimes(1);
    activity.set(window, false);
    expect(tray.update).toHaveBeenLastCalledWith([]);
});
