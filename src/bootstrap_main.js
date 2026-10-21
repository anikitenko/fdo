import {app} from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import {getCleanCliArgs} from './utils/system/cliCommands';
import {cliProfile, resolveCliProfile} from './utils/system/cliProfile';

async function startWithProfile() {
    const args = getCleanCliArgs(process.argv, {defaultApp: !app.isPackaged});
    const base = process.env.FDO_E2E === '1' && process.env.FDO_E2E_USER_DATA_DIR
        ? process.env.FDO_E2E_USER_DATA_DIR : app.getPath('userData');
    const selection = resolveCliProfile(args, base);
    if (selection.name !== 'default') {
        for (const directory of [path.dirname(selection.directory), selection.directory]) {
            if (fs.existsSync(directory) && (fs.lstatSync(directory).isSymbolicLink() || !fs.statSync(directory).isDirectory())) throw new Error(`Profile directory must be a regular directory: ${directory}`);
            fs.mkdirSync(directory, {recursive: true, mode: 0o700});
        }
    }
    if (selection.name !== 'default' || process.env.FDO_E2E === '1') {
        app.setPath('userData', selection.directory);
        app.setPath('sessionData', selection.directory);
    }
    // The SDK eagerly creates its default log directory during module import.
    // Launch Services starts GUI apps with `/` as cwd, which would make that
    // default `/logs` and abort startup before main.js can initialize.
    process.env.FDO_SDK_LOG_ROOT ??= path.join(selection.directory, 'sdk-logs');
    if (process.env.FDO_E2E === '1' && process.env.FDO_E2E_USER_DATA_DIR) process.env.FDO_E2E_USER_DATA_DIR = selection.directory;
    Object.assign(cliProfile, selection, {baseDirectory: path.resolve(base)});
    // Eager bundling keeps the executable layout unchanged while deferring
    // module evaluation until profile selection has configured Electron paths.
    await import(/* webpackMode: "eager" */ './main');
}

try {
    await startWithProfile();
} catch (error) {
    const message = error.message || String(error);
    if (process.argv.includes('--json')) process.stdout.write(JSON.stringify({ok: false, error: {message, code: 'CLI_STARTUP_ERROR'}}) + '\n');
    process.stderr.write(`Error: ${message}\n`);
    await Promise.all([process.stdout, process.stderr].map(stream => new Promise(resolve => stream.write('', resolve))));
    app.exit(2);
}
