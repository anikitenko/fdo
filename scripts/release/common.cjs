'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {execFileSync} = require('node:child_process');
const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+[0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*)?$/;
function parseVersion(version) {
    const match = typeof version === 'string' && version.match(VERSION);
    if (!match) throw new Error(`Invalid semantic version: ${version}`);
    return {version, core: match.slice(1, 4).map(BigInt), prerelease: match[4] || ''};
}
function compareVersions(a, b) {
    a = parseVersion(a);b = parseVersion(b);
    for (let i = 0; i < 3; i++) if (a.core[i] !== b.core[i]) return a.core[i] > b.core[i] ? 1 : -1;
    if (!a.prerelease || !b.prerelease) return a.prerelease ? -1 : b.prerelease ? 1 : 0;
    const left = a.prerelease.split('.'), right = b.prerelease.split('.');
    for (let i = 0; i < Math.max(left.length, right.length); i++) {
        if (left[i] === right[i]) continue;
        if (left[i] === undefined) return -1;if (right[i] === undefined) return 1;
        const ln = /^\d+$/.test(left[i]), rn = /^\d+$/.test(right[i]);
        if (ln && rn) return BigInt(left[i]) > BigInt(right[i]) ? 1 : -1;
        if (ln !== rn) return ln ? -1 : 1;
        return left[i] > right[i] ? 1 : -1;
    }
    return 0;
}
function git(args, cwd = path.resolve(__dirname, '../..')) {return execFileSync('git', args, {cwd, encoding: 'utf8'}).trim();}
function validateRelease({ref, version, lockVersion, lockRootVersion}) {
    const parsed = parseVersion(version);
    if (version !== lockVersion || version !== lockRootVersion) throw new Error('package.json and both package-lock.json versions must match.');
    const publish = ref.startsWith('refs/tags/');
    const tag = publish ? ref.slice('refs/tags/'.length) : '';
    if (publish && tag !== `v${version}`) throw new Error(`Tag must match package version exactly: v${version}`);
    return {version, tag, publish, prerelease: !!parsed.prerelease};
}
async function sha256(file) {
    const hash = crypto.createHash('sha256');
    for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
    return hash.digest('hex');
}
const platforms = { 'mac-arm64': ['dmg', 'zip'], 'mac-x64': ['dmg', 'zip'], 'linux-x64': ['AppImage', 'deb', 'rpm'], 'win-x64': ['setup.exe', 'portable.exe'] };
function assetNames(version, platform) {
    if (!platforms[platform]) throw new Error(`Unsupported release platform: ${platform}`);
    return platforms[platform].map(ext => `fdo-${version}-${platform}${platform.startsWith('win-') ? '-' : '.'}${ext}`);
}
function readJson(file) {return JSON.parse(fs.readFileSync(file, 'utf8'));}
module.exports = {parseVersion, compareVersions, git, validateRelease, sha256, platforms, assetNames, readJson};
