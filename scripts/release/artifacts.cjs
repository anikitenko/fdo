'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {assetNames, platforms, sha256, readJson, parseVersion} = require('./common.cjs');
async function stage({source, destination, version, commit, platform, signed = false, notarized = false}) {
    parseVersion(version);
    if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error('A full source commit is required.');
    const files = [];
    for (const name of assetNames(version, platform)) {
        const file = path.join(source, name);
        let stat;
        try {stat = fs.lstatSync(file);}
        catch (error) {
            if (error.code !== 'ENOENT') throw error;
            const found = fs.existsSync(source) ? fs.readdirSync(source).filter(entry => fs.statSync(path.join(source, entry)).isFile()).join(', ') : '';
            throw new Error(`Missing or invalid release asset: ${name}${found ? ` (found ${found})` : ''}`);
        }
        if (!stat.isFile() || stat.isSymbolicLink() || !stat.size) throw new Error(`Missing or invalid release asset: ${name}`);
        files.push({name, size: stat.size, sha256: await sha256(file)});
    }
    fs.mkdirSync(destination, {recursive: true});
    for (const file of files) fs.copyFileSync(path.join(source, file.name), path.join(destination, file.name), fs.constants.COPYFILE_EXCL);
    const manifest = {schemaVersion: 1, version, commit, platform, signed, notarized, files};
    fs.writeFileSync(path.join(destination, `${platform}.json`), JSON.stringify(manifest, null, 2) + '\n', {flag: 'wx'});
    return manifest;
}
function walk(directory) {
    return fs.readdirSync(directory, {withFileTypes: true}).flatMap(entry => {
        const file = path.join(directory, entry.name);
        if (entry.isSymbolicLink()) throw new Error('Artifact symlinks are not allowed.');
        return entry.isDirectory() ? walk(file) : [file];
    });
}
async function assemble({source, destination, version, commit, stable = false}) {
    const downloaded = walk(source), byName = new Map();
    for (const file of downloaded) {
        const name = path.basename(file);
        if (byName.has(name)) throw new Error(`Duplicate asset: ${name}`);
        byName.set(name, file);
    }
    const builds = [], expected = new Set();
    for (const platform of Object.keys(platforms)) {
        const name = `${platform}.json`;expected.add(name);
        if (!byName.has(name)) throw new Error(`Missing build manifest: ${platform}`);
        const manifest = readJson(byName.get(name));
        if (manifest.schemaVersion !== 1 || manifest.platform !== platform || manifest.version !== version || manifest.commit !== commit) throw new Error(`Mismatched build manifest: ${platform}`);
        if (stable && platform !== 'linux-x64' && (manifest.signed !== true || platform.startsWith('mac-') && manifest.notarized !== true)) throw new Error('Stable desktop assets must be signed and macOS notarized.');
        const names = assetNames(version, platform);
        if (!Array.isArray(manifest.files) || manifest.files.length !== names.length || new Set(manifest.files.map(file => file.name)).size !== names.length) throw new Error(`Invalid artifact inventory: ${platform}`);
        for (const asset of manifest.files) {
            if (!names.includes(asset.name) || !byName.has(asset.name)) throw new Error(`Missing/unexpected asset: ${asset.name}`);
            const file = byName.get(asset.name);
            if (fs.statSync(file).size !== asset.size || await sha256(file) !== asset.sha256) throw new Error(`Artifact checksum mismatch: ${asset.name}`);
            expected.add(asset.name);
        }
        builds.push(manifest);
    }
    if (downloaded.length !== expected.size) throw new Error('Unexpected files in release artifacts.');
    fs.mkdirSync(destination, {recursive: true});
    const assets = builds.flatMap(build => build.files).sort((a, b) => a.name.localeCompare(b.name));
    for (const asset of assets) fs.copyFileSync(byName.get(asset.name), path.join(destination, asset.name), fs.constants.COPYFILE_EXCL);
    fs.writeFileSync(path.join(destination, 'release-manifest.json'), JSON.stringify({schemaVersion: 1, version, commit, builds}, null, 2) + '\n', {flag: 'wx'});
    const inventory = [...assets, {name: 'release-manifest.json', sha256: await sha256(path.join(destination, 'release-manifest.json'))}].sort((a, b) => a.name.localeCompare(b.name));
    fs.writeFileSync(path.join(destination, 'SHA256SUMS'), inventory.map(file => `${file.sha256}  ${file.name}\n`).join(''), {flag: 'wx'});
    return {version, commit, builds};
}
module.exports = {stage, assemble};
if (require.main === module) {
    const env = process.env;
    const operation = process.argv[2] === 'stage'
        ? stage({source: 'release', destination: 'release-staging', version: env.RELEASE_VERSION, commit: env.RELEASE_COMMIT, platform: `${env.RELEASE_PLATFORM}-${env.RELEASE_ARCH}`, ...readJson('release/signing.json')})
        : assemble({source: 'release-downloads', destination: 'release-assets', version: env.RELEASE_VERSION, commit: env.RELEASE_COMMIT, stable: env.RELEASE_PUBLISH === 'true' && !parseVersion(env.RELEASE_VERSION).prerelease});
    operation.catch(error => {console.error(error.message);process.exitCode = 1;});
}
