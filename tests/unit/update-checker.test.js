import {checkForFdoUpdate, compareReleaseVersions} from '../../src/utils/system/updateChecker';

const makeRelease = ({version, prerelease = false, published = '2026-10-18T00:00:00Z', assets = []}) => ({
    tag_name: `v${version}`, name: `FDO ${version}`, body: `Notes for ${version}`,
    prerelease, draft: false, published_at: published, html_url: `https://github.com/anikitenko/fdo/releases/tag/v${version}`, assets,
});
const asset = name => ({name, browser_download_url: `https://github.com/anikitenko/fdo/releases/download/${name}`});
const fetchFor = releases => jest.fn(async () => ({ok: true, json: async () => releases}));

test('compares stable and prerelease semantic versions correctly', () => {
    expect(compareReleaseVersions('1.2.0', '1.1.9')).toBe(1);
    expect(compareReleaseVersions('1.2.0-beta.2', '1.2.0-beta.1')).toBe(1);
    expect(compareReleaseVersions('1.2.0', '1.2.0-beta.2')).toBe(1);
    expect(compareReleaseVersions('1.2.0-beta.1', '1.2.0')).toBe(-1);
});

test('checks the newest stable release, ignores drafts and selects matching macOS assets', async () => {
    const fetchImpl = fetchFor([
        makeRelease({version: '2.0.0-beta.2', prerelease: true, published: '2026-10-19T00:00:00Z'}),
        makeRelease({version: '1.4.0', published: '2026-10-18T00:00:00Z', assets: [
            asset('fdo-1.4.0-mac-arm64.dmg'), asset('fdo-1.4.0-mac-arm64.zip'), asset('fdo-1.4.0-mac-x64.dmg'),
        ]}),
        {...makeRelease({version: '9.0.0'}), draft: true},
    ]);
    const result = await checkForFdoUpdate({channel: 'stable', currentVersion: '1.3.0', platform: 'mac-arm64', fetchImpl});
    expect(result).toMatchObject({success: true, channel: 'stable', latestVersion: '1.4.0', hasUpdate: true, releaseNotes: 'Notes for 1.4.0'});
    expect(result.downloads.map(item => item.name)).toEqual(['fdo-1.4.0-mac-arm64.dmg', 'fdo-1.4.0-mac-arm64.zip']);
    expect(fetchImpl).toHaveBeenCalledWith(expect.stringContaining('/releases?per_page=100'), expect.objectContaining({headers: expect.any(Object)}));
});

test('checks prereleases separately and matches Windows installer assets', async () => {
    const fetchImpl = fetchFor([
        makeRelease({version: '1.8.0', published: '2026-10-18T00:00:00Z'}),
        makeRelease({version: '1.9.0-rc.1', prerelease: true, published: '2026-10-19T00:00:00Z', assets: [
            asset('fdo-1.9.0-rc.1-win-x64-setup.exe'), asset('fdo-1.9.0-rc.1-win-x64-portable.exe'), asset('fdo-1.9.0-rc.1-mac-arm64.dmg'),
        ]}),
    ]);
    const result = await checkForFdoUpdate({channel: 'prerelease', currentVersion: '1.8.0', platform: 'win-x64', fetchImpl});
    expect(result.latestVersion).toBe('1.9.0-rc.1');
    expect(result.downloads.map(item => item.name)).toEqual(['fdo-1.9.0-rc.1-win-x64-setup.exe', 'fdo-1.9.0-rc.1-win-x64-portable.exe']);
});

test('returns a clear failure when the selected channel has no releases', async () => {
    await expect(checkForFdoUpdate({channel: 'prerelease', currentVersion: '1.0.0', platform: 'linux-x64', fetchImpl: fetchFor([])}))
        .rejects.toThrow('No prerelease releases are available yet.');
});
