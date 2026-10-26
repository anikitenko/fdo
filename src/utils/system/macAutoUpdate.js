import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn, spawnSync} from 'node:child_process';

export const MAC_UPDATE_HOSTS = new Set([
    'github.com',
    'objects.githubusercontent.com',
    'release-assets.githubusercontent.com',
    'github-releases.githubusercontent.com',
]);

const fetchHeaders = {'Accept': 'application/octet-stream', 'User-Agent': 'FDO-updater'};

export function parseSha256Sums(text = '') {
    const sums = new Map();
    for (const line of String(text).split('\n')) {
        const match = /^([a-f0-9]{64}) {2}([^/\s]+)$/.exec(line.trim());
        if (match) sums.set(match[2], match[1]);
    }
    return sums;
}

export function assertGithubDownloadUrl(url) {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || !MAC_UPDATE_HOSTS.has(parsed.hostname)) {
        throw new Error('Refusing an update download from an unexpected host.');
    }
    return parsed;
}

async function fetchText(fetchImpl, url) {
    const response = await fetchImpl(url, {headers: fetchHeaders, signal: AbortSignal.timeout(10000)});
    if (!response?.ok || typeof response.text !== 'function') return '';
    return response.text();
}

export async function describePublishedMacUpdate({latestVersion, platform, assets = [], fetchImpl}) {
    if (!String(platform || '').startsWith('mac-')) {
        return {available: false, reason: 'Automatic install is only available for signed macOS builds.'};
    }
    const zipName = `fdo-${latestVersion}-${platform}.zip`;
    const zip = assets.find(asset => asset.name === zipName);
    const sumsAsset = assets.find(asset => asset.name === 'SHA256SUMS');
    const manifestAsset = assets.find(asset => asset.name === 'release-manifest.json');
    if (!zip?.browser_download_url || !sumsAsset?.browser_download_url || !manifestAsset?.browser_download_url) {
        return {available: false, reason: 'This release does not include a checksummed macOS update archive.'};
    }
    let manifest;
    try {
        const [sumsText, manifestText] = await Promise.all([
            fetchText(fetchImpl, sumsAsset.browser_download_url),
            fetchText(fetchImpl, manifestAsset.browser_download_url),
        ]);
        manifest = JSON.parse(manifestText);
        const publishedSha = parseSha256Sums(sumsText).get(zipName);
        const build = Array.isArray(manifest?.builds) ? manifest.builds.find(item => item.platform === platform) : null;
        const file = build?.files?.find(item => item.name === zipName);
        if (!build?.signed || !build?.notarized) {
            return {available: false, reason: 'The published macOS build is not signed and notarized.'};
        }
        if (!publishedSha || publishedSha !== file?.sha256) {
            return {available: false, reason: 'The macOS update archive has no matching checksum.'};
        }
        assertGithubDownloadUrl(zip.browser_download_url);
        return {available: true, asset: {name: zipName, url: zip.browser_download_url, sha256: publishedSha}};
    } catch {
        return {available: false, reason: 'The published macOS update could not be verified.'};
    }
}

export function assessCurrentMacApp({platform = process.platform, packaged = false, appPath = '', run = defaultCommand} = {}) {
    if (platform !== 'darwin' || !packaged || !String(appPath).endsWith('.app')) {
        return {eligible: false, reason: 'Automatic update runs only in a signed and notarized Mac app.'};
    }
    try {
        run('codesign', ['--verify', '--deep', '--strict', appPath]);
        run('xcrun', ['stapler', 'validate', appPath]);
        run('spctl', ['--assess', '--type', 'execute', appPath]);
        return {eligible: true, appPath};
    } catch {
        return {eligible: false, reason: 'This Mac app is not signed and notarized, so FDO will not replace it automatically.'};
    }
}

function defaultCommand(command, args) {
    const result = spawnSync(command, args, {stdio: 'ignore'});
    if (result.error || result.status !== 0) throw new Error(`${command} failed.`);
}

export function applyLocalMacSignature(published, local) {
    if (!published?.available || !published.asset) {
        return {available: false, reason: published?.reason || 'No signed macOS update is published.'};
    }
    if (!local?.eligible) return {available: false, reason: local?.reason || 'This Mac app is not signed and notarized.'};
    return {available: true, asset: published.asset};
}

export async function downloadUpdateArchive({url, sha256, fetchImpl, redirectLimit = 5}) {
    let current = url;
    for (let hop = 0; hop <= redirectLimit; hop++) {
        assertGithubDownloadUrl(current);
        const response = await fetchImpl(current, {headers: fetchHeaders, redirect: 'manual', signal: AbortSignal.timeout(120000)});
        if ([301, 302, 303, 307, 308].includes(response.status)) {
            const location = response.headers?.get?.('location');
            if (!location) throw new Error('Update download redirect is missing a location.');
            current = new URL(location, current).href;
            continue;
        }
        if (!response.ok) throw new Error(`Update download failed (${response.status}).`);
        const bytes = Buffer.from(await response.arrayBuffer());
        const digest = crypto.createHash('sha256').update(bytes).digest('hex');
        if (digest !== sha256) throw new Error('Update archive checksum did not match the published release.');
        return bytes;
    }
    throw new Error('Update download redirected too many times.');
}

function findAppBundle(directory) {
    for (const entry of fs.readdirSync(directory, {withFileTypes: true})) {
        const candidate = path.join(directory, entry.name);
        if (entry.isDirectory() && entry.name.endsWith('.app')) return candidate;
        if (entry.isDirectory() && !entry.isSymbolicLink()) {
            const found = findAppBundle(candidate);
            if (found) return found;
        }
    }
    return '';
}

export async function installMacAutoUpdate({asset, appPath, fetchImpl = fetch, pid = process.pid} = {}) {
    const local = assessCurrentMacApp({platform: 'darwin', packaged: true, appPath});
    if (!local.eligible) throw new Error(local.reason);
    if (!asset?.url || !/^[a-f0-9]{64}$/.test(asset.sha256 || '')) throw new Error('The macOS update is missing a checksum.');
    const bytes = await downloadUpdateArchive({url: asset.url, sha256: asset.sha256, fetchImpl});
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'fdo-update-'));
    const extracted = path.join(temp, 'extracted');
    fs.mkdirSync(extracted);
    fs.writeFileSync(path.join(temp, 'update.zip'), bytes);
    try {
        defaultCommand('ditto', ['-x', '-k', path.join(temp, 'update.zip'), extracted]);
        const staged = findAppBundle(extracted);
        if (!staged) throw new Error('The update archive does not contain a Mac app.');
        const stagedCheck = assessCurrentMacApp({platform: 'darwin', packaged: true, appPath: staged});
        if (!stagedCheck.eligible) throw new Error('The downloaded Mac app is not signed and notarized.');
        const scriptPath = path.join(temp, 'swap.command');
        fs.writeFileSync(scriptPath, macUpdateSwapScript(), {mode: 0o700});
        const child = spawn('/bin/bash', [scriptPath, String(pid), appPath, staged, temp], {detached: true, stdio: 'ignore'});
        child.unref();
        return {success: true};
    } catch (error) {
        fs.rmSync(temp, {recursive: true, force: true});
        throw error;
    }
}

export function macUpdateSwapScript() {
    return `#!/bin/bash
set -euo pipefail
app_pid="$1"
target="$2"
source="$3"
temp="$4"
while kill -0 "$app_pid" 2>/dev/null; do
  sleep 0.2
done
rm -rf "$target"
ditto "$source" "$target"
xattr -dr com.apple.quarantine "$target" || true
open "$target"
rm -rf "$temp"
`;
}
