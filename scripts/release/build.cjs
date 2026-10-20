'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {spawnSync} = require('node:child_process');
const {parseVersion, readJson, git} = require('./common.cjs');
function releaseConfig(metadata, {platform, arch, publish, env = process.env}) {
    if (!['mac', 'linux', 'win'].includes(platform) || !['x64', 'arm64'].includes(arch)) throw new Error('Invalid platform/architecture.');
    const stable = publish && !parseVersion(metadata.version).prerelease;
    const macCredentials = !!env.MAC_CSC_LINK && (!!env.APPLE_API_KEY_BASE64 && !!env.APPLE_API_KEY_ID && !!env.APPLE_API_ISSUER || !!env.APPLE_ID && !!env.APPLE_APP_SPECIFIC_PASSWORD && !!env.APPLE_TEAM_ID);
    const signed = publish && (platform === 'mac' ? macCredentials : platform === 'win' ? !!env.WIN_CSC_LINK : false);
    if (stable && platform !== 'linux' && !signed) throw new Error(`Stable ${platform} releases require code signing${platform === 'mac' ? ' and notarization' : ''} credentials.`);
    if (publish && platform === 'mac' && !!env.MAC_CSC_LINK !== !!macCredentials) throw new Error('Incomplete Apple signing/notarization credentials.');
    const config = {...metadata.build, publish: null, forceCodeSigning: !!signed};
    if (platform === 'mac') config.mac = {...config.mac, target: [{target: 'dmg', arch: [arch]}, {target: 'zip', arch: [arch]}], artifactName: 'fdo-${version}-mac-${arch}.${ext}', hardenedRuntime: !!signed, notarize: !!signed, ...(!signed ? {identity: null} : {})};
    if (platform === 'linux') config.linux = {...config.linux, target: ['AppImage', 'deb', 'rpm'].map(target => ({target, arch: [arch]})), artifactName: 'fdo-${version}-linux-${arch}.${ext}'};
    if (platform === 'win') {
        config.win = {...config.win, target: [{target: 'nsis', arch: [arch]}, {target: 'portable', arch: [arch]}]};
        config.nsis = {...config.nsis, artifactName: 'fdo-${version}-win-${arch}-setup.${ext}'};
        config.portable = {...config.portable, artifactName: 'fdo-${version}-win-${arch}-portable.${ext}'};
    }
    return {config, signed: !!signed, notarized: platform === 'mac' && !!signed};
}
function run(command, args, options = {}) {
    const result = spawnSync(command, args, {stdio: 'inherit', ...options});
    if (result.error) throw result.error;if (result.status !== 0) throw new Error(`${path.basename(command)} failed (${result.status}).`);
}
function main(env = process.env) {
    const metadata = readJson('package.json'), platform = env.RELEASE_PLATFORM, arch = env.RELEASE_ARCH;
    const expected = {darwin: 'mac', win32: 'win', linux: 'linux'}[process.platform];
    if (platform !== expected || arch !== process.arch) throw new Error('Release builds must run on the matching native OS and architecture.');
    if (env.RELEASE_COMMIT && git(['rev-parse', 'HEAD']) !== env.RELEASE_COMMIT) throw new Error('Build checkout does not match the validated release commit.');
    if (env.RELEASE_VERSION && metadata.version !== env.RELEASE_VERSION) throw new Error('Build version does not match the validated release version.');
    const output = env.FDO_RELEASE_OUTPUT || 'release';
    const {config, signed, notarized} = releaseConfig(metadata, {platform, arch, publish: env.RELEASE_PUBLISH === 'true', env});
    config.directories = {...config.directories, output};
    if (process.argv.includes('--check')) {console.log(`${platform}-${arch}: ${signed ? 'signing configured' : 'unsigned build'}`);return;}
    const temp = fs.mkdtempSync(path.join(env.RUNNER_TEMP || os.tmpdir(), 'fdo-release-'));
    const childEnv = {...env, CSC_IDENTITY_AUTO_DISCOVERY: 'false'};
    try {
        if (platform === 'mac' && signed) {
            childEnv.CSC_LINK = env.MAC_CSC_LINK;childEnv.CSC_KEY_PASSWORD = env.MAC_CSC_KEY_PASSWORD || '';
            if (env.APPLE_API_KEY_BASE64) {const key = path.join(temp, 'AuthKey.p8');fs.writeFileSync(key, Buffer.from(env.APPLE_API_KEY_BASE64, 'base64'), {mode: 0o600});childEnv.APPLE_API_KEY = key;}
        }
        const file = path.join(temp, 'builder.json');fs.writeFileSync(file, JSON.stringify(config));
        run(process.execPath, ['node_modules/electron-builder/cli.js', '--config', file, `--${platform}`, `--${arch}`, '--publish', 'never'], {env: childEnv});
        if (platform === 'mac' && signed) {
            const root = path.resolve(output, arch === 'x64' ? 'mac' : `mac-${arch}`, `${metadata.build.executableName || metadata.build.productName}.app`);
            run('codesign', ['--verify', '--deep', '--strict', root]);run('xcrun', ['stapler', 'validate', root]);run('spctl', ['--assess', '--type', 'execute', root]);
        }
        if (platform === 'win' && signed) {
            const script = `$ErrorActionPreference='Stop'; $files=@(Get-ChildItem -LiteralPath $env:FDO_RELEASE_OUTPUT -Filter *.exe); $files+=Get-Item -LiteralPath $env:FDO_RELEASE_EXECUTABLE; foreach($file in $files){if((Get-AuthenticodeSignature -LiteralPath $file.FullName).Status -ne 'Valid'){throw 'Invalid Authenticode signature'}}`;
            run('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], {env: {...childEnv, FDO_RELEASE_OUTPUT: path.resolve(output), FDO_RELEASE_EXECUTABLE: path.resolve(output, 'win-unpacked', `${metadata.build.executableName || metadata.build.productName}.exe`)}});
        }
        fs.writeFileSync(path.join(output, 'signing.json'), JSON.stringify({signed, notarized}));
    } finally {fs.rmSync(temp, {recursive: true, force: true});}
}
module.exports = {releaseConfig, main};
if (require.main === module) {try {main();} catch (error) {console.error(error.message);process.exitCode = 1;}}
