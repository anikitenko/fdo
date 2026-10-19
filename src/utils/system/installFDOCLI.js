import {homedir, platform} from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import {lookpath} from 'lookpath';
import {execFileSync} from 'node:child_process';
import {app} from 'electron';
import {runWithSudo} from './runWithSudo';

const MARKER = 'FDO CLI wrapper v1';
const quoteShell = value => "'" + value.replace(/'/g, "'\\''") + "'";

export function getPlatformPaths(osType, home = homedir()) {
    if (osType === 'darwin' || osType === 'linux') return {primary: '/usr/local/bin/fdo', fallbacks: [path.join(home, '.local', 'bin', 'fdo'), path.join(home, 'bin', 'fdo')]};
    if (osType === 'win32') return {primary: path.win32.join(home, 'AppData', 'Local', 'FDO', 'bin', 'fdo.cmd'), fallbacks: []};
    return {primary: null, fallbacks: []};
}

export function createWrapperScript(executable, application, osType, development) {
    if ([executable, application].some(value => value != null && /[\0\r\n]/.test(value))) throw new Error('CLI paths cannot contain line breaks or null bytes.');
    const args = [executable, ...(development && application ? [application] : [])];
    if (osType === 'darwin' || osType === 'linux') return `#!/bin/sh\n# ${MARKER}\nif [ "$#" -eq 0 ]; then set -- --help; fi\nexec ${args.map(quoteShell).join(' ')} "$@"\n`;
    if (osType === 'win32') {
        if (args.some(value => value.includes('"'))) throw new Error('Invalid quote in Windows CLI path.');
        const command = args.map(value => '"' + value.replace(/%/g, '%%') + '"').join(' ');
        // No parenthesized expansion block; preserve the child's exit status.
        return `@echo off\r\nrem ${MARKER}\r\nsetlocal DisableDelayedExpansion\r\nif "%~1"=="" goto fdo_help\r\n${command} %*\r\nexit /b %errorlevel%\r\n:fdo_help\r\n${command} --help\r\nexit /b %errorlevel%\r\n`;
    }
    throw new Error(`Unsupported platform: ${osType}`);
}

function isOwnedWrapper(file) {
    try {
        const stat = fs.lstatSync(file);
        if (!stat.isFile() || stat.size > 65536) return false;
        const text = fs.readFileSync(file, 'utf8');
        if (/^(?:#!\/bin\/sh\n# |@echo off\r?\nrem )FDO CLI wrapper v1\r?\n/.test(text)) return true;
        // Recognize only the complete templates shipped by earlier FDO versions.
        return /^#!\/bin\/(?:sh|bash)\n# If no arguments provided, show help\nif \[ \$# -eq 0 ]; then\n {2}exec "[^"\n]+"(?: "[^"\n]+")? --help\nelse\n {2}exec "[^"\n]+"(?: "[^"\n]+")? "\$@"\nfi\n$/.test(text)
            || /^@echo off\r?\nif "%~1"=="" \(\r?\n {2}"[^"\r\n]+"(?: "[^"\r\n]+")? --help\r?\n\) else \(\r?\n {2}"[^"\r\n]+"(?: "[^"\r\n]+")? %\*\r?\n\)\r?\n$/.test(text);
    } catch {return false;}
}

function pathExists(file) {try {fs.lstatSync(file); return true;} catch (error) {if (error.code === 'ENOENT') return false; throw error;}}
function isPathWritable(file) {
    try {
        let parent = path.dirname(file);
        while (!fs.existsSync(parent)) parent = path.dirname(parent);
        if (!fs.statSync(parent).isDirectory()) return false;
        fs.accessSync(parent, fs.constants.W_OK);
        return true;
    } catch {return false;}
}
function candidates(paths) {return [...new Set([paths.primary, ...paths.fallbacks].filter(Boolean))];}

function updateWindowsPath(directory, remove = false) {
    // Values travel in the environment, never in PowerShell source or a shell command.
    const script = `$directory = $env:FDO_CLI_INSTALL_DIR
$entries = @(([Environment]::GetEnvironmentVariable('Path','User') -split ';') | Where-Object { $_ -and $_.TrimEnd('\\') -ine $directory.TrimEnd('\\') })
${remove ? '' : '$entries += $directory'}
[Environment]::SetEnvironmentVariable('Path', ($entries -join ';'), 'User')`;
    execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], {
        env: {...process.env, FDO_CLI_INSTALL_DIR: directory}, windowsHide: true, stdio: 'pipe', timeout: 15000,
    });
}

export async function installCli({osType, paths, executable, application, packaged, elevate = runWithSudo, updatePath = updateWindowsPath, icon}) {
    try {
        if (!paths.primary) return {success: false, error: `Unsupported platform: ${osType}`};
        // app.isPackaged is authoritative; folder names and NODE_ENV are not.
        const content = createWrapperScript(executable, application, osType, !packaged);
        const all = candidates(paths), owned = all.filter(isOwnedWrapper);
        const available = all.filter(file => !pathExists(file));
        const targets = owned.length ? owned : [available.find(isPathWritable) || available[0]];
        if (!targets[0]) return {success: false, error: 'The fdo command paths are occupied by unrelated files. Move those files before installing FDO CLI.'};
        let changed = false;
        for (const target of targets) {
            if (isOwnedWrapper(target) && fs.readFileSync(target, 'utf8') === content && (osType === 'win32' || (fs.statSync(target).mode & 0o111) === 0o111)) continue;
            if (pathExists(target) && !isOwnedWrapper(target)) return {success: false, error: `Refusing to replace an unrelated file: ${target}`};
            if (isPathWritable(target)) {
                fs.mkdirSync(path.dirname(target), {recursive: true});
                const temporary = path.join(fs.mkdtempSync(path.join(path.dirname(target), '.fdo-cli-')), 'fdo');
                try {fs.writeFileSync(temporary, content, {mode: 0o755}); fs.renameSync(temporary, target);}
                finally {fs.rmSync(path.dirname(temporary), {recursive: true, force: true});}
            } else if (osType !== 'win32') {
                const temporaryDir = fs.mkdtempSync(path.join(app.getPath('temp'), 'fdo-cli-'));
                try {
                    const temporary = path.join(temporaryDir, 'fdo'); fs.writeFileSync(temporary, content, {mode: 0o755});
                    const result = await elevate(`install -d ${quoteShell(path.dirname(target))} && install -m 755 ${quoteShell(temporary)} ${quoteShell(target)}`, {name: 'FDO', icns: icon, confirmMessage: `Install or repair FDO CLI at ${target}?`});
                    if (result === 'skip') return {success: false, error: 'skip'};
                } finally {fs.rmSync(temporaryDir, {recursive: true, force: true});}
            } else return {success: false, error: `Cannot write ${target}. Check directory permissions.`};
            changed = true;
        }
        let warning;
        if (osType === 'win32') {
            try {updatePath(path.dirname(targets[0]));}
            catch (error) {warning = `The command was installed, but PATH could not be updated: ${error.message}. Add ${path.dirname(targets[0])} to your user PATH.`;}
        }
        return {success: true, path: targets[0], paths: targets, skipped: !changed, updated: changed && owned.length > 0, developmentMode: !packaged, ...(warning ? {warning} : {})};
    } catch (error) {return {success: false, error: error.message};}
}

export async function removeCli({osType, paths, elevate = runWithSudo, updatePath = updateWindowsPath, icon}) {
    const removed = [];
    try {
        const all = candidates(paths), owned = all.filter(isOwnedWrapper);
        if (!owned.length && all.some(pathExists)) return {success: false, error: 'No managed FDO CLI wrapper found. Unrelated files and symlinks were preserved.', paths: removed};
        for (const file of owned) {
            if (isPathWritable(file)) fs.unlinkSync(file);
            else if (osType !== 'win32') {
                const result = await elevate(`rm -f ${quoteShell(file)}`, {name: 'FDO', icns: icon, confirmMessage: `Remove FDO CLI at ${file}?`});
                if (result === 'skip') return {success: false, error: 'skip', paths: removed};
            } else return {success: false, error: `Cannot remove ${file}. Check directory permissions.`, paths: removed};
            removed.push(file);
        }
        let warning;
        if (osType === 'win32' && removed.length) {
            try {updatePath(path.dirname(removed[0]), true);}
            catch (error) {warning = `The wrapper was removed, but PATH cleanup failed: ${error.message}`;}
        }
        return {success: true, path: removed[0], paths: removed, notFound: !removed.length, ...(warning ? {warning} : {})};
    } catch (error) {return {success: false, error: error.message, paths: removed};}
}

export function cliExecutable({osType, packaged, executable = process.execPath, appImage = process.env.APPIMAGE}) {
    // AppImage's internal executable lives in a temporary mount removed on exit.
    return osType === 'linux' && packaged && appImage ? fs.realpathSync(appImage) : executable;
}

function installationOptions(removing = false) {
    const osType = platform();
    return {osType, paths: getPlatformPaths(osType), executable: removing ? process.execPath : cliExecutable({osType, packaged: app.isPackaged}), application: app.getAppPath(), packaged: app.isPackaged,
        icon: path.join(app.getAppPath(), 'dist', 'renderer', 'assets', 'icons', 'fdo_icon.icns')};
}
export function getCliInstallationStatus() {
    const paths = candidates(getPlatformPaths(platform())).filter(isOwnedWrapper);
    return {success: paths.length > 0, path: paths[0], paths};
}
export async function installFDOCLI() {
    try {return await installCli(installationOptions());} catch (error) {return {success:false,error:error.message};}
}
export async function removeFDOCLI() {
    try {return await removeCli(installationOptions(true));} catch (error) {return {success:false,error:error.message};}
}

export async function inspectCliInstallation(options = installationOptions(), findCommand = lookpath) {
    const expected = createWrapperScript(options.executable, options.application, options.osType, !options.packaged);
    const paths = candidates(options.paths).filter(file => isOwnedWrapper(file)
        && fs.readFileSync(file, 'utf8') === expected
        && (options.osType === 'win32' || (fs.statSync(file).mode & 0o111) === 0o111));
    const resolved = await findCommand('fdo');
    const samePath = file => options.osType === 'win32'
        ? path.resolve(file).toLowerCase() === path.resolve(resolved || '.').toLowerCase()
        : file === resolved;
    return {current: paths.length > 0, path: paths[0], inPath: !!resolved && paths.some(samePath)};
}
