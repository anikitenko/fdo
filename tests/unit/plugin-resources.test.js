import {readdir} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {samplePluginFileDescriptors, sanitizePluginResources} from '../../src/utils/plugins/runtime/pluginResources';
jest.mock('node:fs/promises', () => ({readdir: jest.fn()}));
jest.mock('node:child_process', () => ({execFile: jest.fn()}));
const originalPlatform = process.platform;
afterEach(() => {
    jest.resetAllMocks();
    Object.defineProperty(process, 'platform', {value: originalPlatform});
});
const platform = value => Object.defineProperty(process, 'platform', {value});

test('samples Linux descriptors and detects substantial growth from a session baseline', async () => {
    platform('linux');
    readdir.mockResolvedValue(['0', '1', '2', 'not-an-fd']);
    expect(await samplePluginFileDescriptors(123)).toEqual({count: 3, deltaSinceStart: 0, status: 'ok'});
    expect(readdir).toHaveBeenCalledWith('/proc/123/fd');
    readdir.mockResolvedValue(Array.from({length: 200}, (_, i) => String(i)));
    expect(await samplePluginFileDescriptors(123, 3)).toEqual({count: 200, deltaSinceStart: 197, status: 'growing'});
});

test('samples macOS with a bounded lsof subprocess and counts only numeric descriptors', async () => {
    platform('darwin');
    execFile.mockImplementation((_path, _args, _options, callback) => callback(null, 'p123\nfcwd\nftxt\nf0\nf1\nf2\n'));
    expect(await samplePluginFileDescriptors(123)).toMatchObject({count: 3, status: 'ok'});
    expect(execFile).toHaveBeenCalledWith('/usr/sbin/lsof', ['-nP', '-a', '-p', '123', '-Ff'],
        expect.objectContaining({timeout: 1500, maxBuffer: 1048576}), expect.any(Function));
});

test('reports unsupported, inaccessible and exited processes as unavailable', async () => {
    platform('win32');
    expect(await samplePluginFileDescriptors(123)).toMatchObject({count: null, status: 'unavailable'});
    platform('linux');
    readdir.mockRejectedValue(new Error('permission denied'));
    expect(await samplePluginFileDescriptors(123)).toMatchObject({count: null, status: 'unavailable'});
    expect(await samplePluginFileDescriptors('../123')).toMatchObject({count: null, status: 'unavailable'});
});

test('sanitizes worker counters without accepting paths or forged host measurements', () => {
    const result = sanitizePluginResources({
        sampledAt: 'invalid', process: {pid: 123, rssBytes: -1, heapUsedBytes: Infinity},
        storage: {pendingWrites: 2, writeFailures: 1, lastFailureCode: '/secret/path'},
        logging: {stderrFallbacks: 1, lastFailureCode: 'EMFILE'},
        fileDescriptors: {count: 9999}, secret: 'private',
    });
    expect(result).toMatchObject({process: {pid: 123, rssBytes: 0, heapUsedBytes: 0},
        storage: {pendingWrites: 2, writeFailures: 1, lastFailureCode: undefined},
        logging: {stderrFallbacks: 1, lastFailureCode: 'EMFILE'}});
    expect(result).not.toHaveProperty('fileDescriptors');
    expect(result).not.toHaveProperty('secret');
    expect(sanitizePluginResources(undefined)).toBeUndefined();
});
