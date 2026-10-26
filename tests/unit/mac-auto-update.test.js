import crypto from 'node:crypto';
import {applyLocalMacSignature, assertGithubDownloadUrl, assessCurrentMacApp, downloadUpdateArchive} from '../../src/utils/system/macAutoUpdate';

test('installs a signed macOS update only for a signed local app and a verified archive', () => {
    const asset = {name: 'fdo-1.4.0-mac-arm64.zip', url: 'https://github.com/anikitenko/fdo/releases/download/fdo-1.4.0-mac-arm64.zip', sha256: 'ab'};
    expect(applyLocalMacSignature({available: true, asset}, {eligible: true})).toEqual({available: true, asset});
    expect(applyLocalMacSignature({available: true, asset}, {eligible: false, reason: 'unsigned'})).toEqual({available: false, reason: 'unsigned'});
    expect(applyLocalMacSignature({available: false, reason: 'not notarized'}, {eligible: true}).available).toBe(false);
    expect(assessCurrentMacApp({platform: 'darwin', packaged: false, appPath: '/Applications/FDO.app'}).eligible).toBe(false);
    expect(assessCurrentMacApp({
        platform: 'darwin', packaged: true, appPath: '/Applications/FDO.app',
        run: () => {},
    }).eligible).toBe(true);
});

test('downloads a GitHub update archive only when the checksum matches', async () => {
    const bytes = Buffer.from('fdo-update');
    const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
    const fetchImpl = jest.fn()
        .mockResolvedValueOnce({status: 302, headers: {get: () => 'https://objects.githubusercontent.com/fdo.zip'}})
        .mockResolvedValueOnce({ok: true, status: 200, arrayBuffer: async () => bytes});
    await expect(downloadUpdateArchive({
        url: 'https://github.com/anikitenko/fdo/releases/download/fdo.zip',
        sha256,
        fetchImpl,
    })).resolves.toEqual(bytes);
    expect(() => assertGithubDownloadUrl('http://github.com/anikitenko/fdo/releases/download/fdo.zip')).toThrow(/unexpected host/);
    expect(() => assertGithubDownloadUrl('https://example.com/fdo.zip')).toThrow(/unexpected host/);
    await expect(downloadUpdateArchive({
        url: 'https://github.com/anikitenko/fdo/releases/download/fdo.zip',
        sha256: 'b'.repeat(64),
        fetchImpl: jest.fn(async () => ({ok: true, status: 200, arrayBuffer: async () => bytes})),
    })).rejects.toThrow(/checksum/);
});
