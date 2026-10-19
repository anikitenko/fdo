export const compareReleaseVersions = (left, right) => {
    const parse = value => {
        const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(String(value || ''));
        return match ? {core: match.slice(1, 4).map(Number), pre: match[4]?.split('.') || []} : null;
    };
    const a = parse(left), b = parse(right);
    if (!a || !b) return 0;
    for (let i = 0; i < 3; i++) if (a.core[i] !== b.core[i]) return a.core[i] > b.core[i] ? 1 : -1;
    if (!a.pre.length || !b.pre.length) return a.pre.length ? -1 : b.pre.length ? 1 : 0;
    for (let i = 0; i < Math.max(a.pre.length, b.pre.length); i++) {
        if (a.pre[i] === undefined) return -1;
        if (b.pre[i] === undefined) return 1;
        if (a.pre[i] === b.pre[i]) continue;
        const an = /^\d+$/.test(a.pre[i]), bn = /^\d+$/.test(b.pre[i]);
        if (an && bn) return Number(a.pre[i]) > Number(b.pre[i]) ? 1 : -1;
        if (an !== bn) return an ? -1 : 1;
        return a.pre[i] > b.pre[i] ? 1 : -1;
    }
    return 0;
};

const expectedAssetNames = (version, platform) => ({
    'mac-arm64': [`fdo-${version}-mac-arm64.dmg`, `fdo-${version}-mac-arm64.zip`],
    'mac-x64': [`fdo-${version}-mac-x64.dmg`, `fdo-${version}-mac-x64.zip`],
    'win-x64': [`fdo-${version}-win-x64-setup.exe`, `fdo-${version}-win-x64-portable.exe`],
    'linux-x64': [`fdo-${version}-linux-x64.AppImage`, `fdo-${version}-linux-x64.deb`, `fdo-${version}-linux-x64.rpm`],
}[platform] || []);

export const checkForFdoUpdate = async ({channel = 'stable', currentVersion, platform, fetchImpl = fetch}) => {
    if (!['stable', 'prerelease'].includes(channel)) throw new Error('Unsupported release channel.');
    const response = await fetchImpl('https://api.github.com/repos/anikitenko/fdo/releases?per_page=100', {
        headers: {'Accept': 'application/vnd.github+json', 'User-Agent': 'FDO-updater'},
        signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error(`Release check failed (${response.status}).`);
    const releases = await response.json();
    const release = releases.filter(item => !item.draft && (channel === 'prerelease' ? item.prerelease : !item.prerelease))
        .sort((a, b) => new Date(b.published_at || b.created_at) - new Date(a.published_at || a.created_at))[0];
    if (!release) throw new Error(`No ${channel} releases are available yet.`);

    const latestVersion = String(release.tag_name || '').replace(/^v/, '');
    const assets = Array.isArray(release.assets) ? release.assets : [];
    const downloads = expectedAssetNames(latestVersion, platform)
        .map(name => assets.find(asset => asset.name === name)).filter(Boolean)
        .map(asset => ({name: asset.name, url: asset.browser_download_url}));
    return {
        success: true,
        currentVersion,
        latestVersion,
        hasUpdate: compareReleaseVersions(latestVersion, currentVersion) > 0,
        channel,
        platform,
        downloads,
        releaseUrl: release.html_url || 'https://github.com/anikitenko/fdo/releases/latest',
        releaseName: release.name || '',
        releaseNotes: release.body || '',
    };
};
