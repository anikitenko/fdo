import build from '../../../src/components/editor/utils/build';
import runTests from '../../../src/components/editor/utils/runTests';
import workspace from '../../../src/components/editor/utils/VirtualFS';

jest.mock('../../../src/components/editor/utils/VirtualFS', () => ({__esModule: true, default: {
    pluginName: 'calculator-id', getLatestContent: jest.fn(() => ({'/package.json': '{"name":"calculator-package"}'})),
    build: {getMetadata: jest.fn(async () => ({name: 'Rose Calculator'})), setInProgress: jest.fn(), addProgress: jest.fn(), addMessage: jest.fn(), stopProgress: jest.fn(), setContent: jest.fn()},
}}));
beforeEach(() => {
    jest.useFakeTimers();
    window.electron.notifications = {add: jest.fn()};
    window.electron.plugin.build = jest.fn(async () => ({success: true, files: {outputFiles: [{text: 'module.exports = {};'}]}}));
    window.electron.plugin.runTests = jest.fn(async () => ({success: true}));
});
afterEach(() => {jest.clearAllTimers(); jest.useRealTimers();});

test('build and test successes identify the plugin by its display name', async () => {
    await build(); await runTests();
    expect(window.electron.notifications.add).toHaveBeenCalledWith('Rose Calculator: build completed', expect.any(String), 'success', {source: 'builds'});
    expect(window.electron.notifications.add).toHaveBeenCalledWith('Rose Calculator: tests passed', expect.stringContaining('test suite completed successfully'), 'success', {source: 'builds'});
});

test('names failure and skipped-test notifications and falls back when source metadata is invalid', async () => {
    workspace.build.getMetadata.mockRejectedValueOnce(new Error('Incomplete source'));
    window.electron.plugin.build.mockResolvedValueOnce({success: false, error: 'Syntax error'});
    await build();
    expect(window.electron.notifications.add).toHaveBeenCalledWith('calculator-package: build failed', expect.stringContaining('compiler output'), 'danger', {source: 'builds', details: 'Syntax error'});
    window.electron.plugin.runTests.mockResolvedValueOnce({success: true, skipped: true});
    await runTests();
    expect(window.electron.notifications.add).toHaveBeenCalledWith('Rose Calculator: no tests found', expect.any(String), 'warning', {source: 'builds'});
});
