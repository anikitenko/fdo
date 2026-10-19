import fs from 'node:fs';
import path from 'node:path';
import {StringDecoder} from 'node:string_decoder';
import {readCliRegistry} from './cliPluginOperations';

function logFiles(profile, registryFile, id) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(id) || !readCliRegistry(registryFile).plugins.some(plugin => plugin?.id === id)) throw new Error(`Plugin not found: ${id}`);
    let directory = profile;
    for (const component of ['plugin-data', id, 'logs']) {
        directory = path.join(directory, component);
        if (!fs.existsSync(directory)) return [];
        const stat = fs.lstatSync(directory);
        if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Plugin log path must contain regular directories.');
    }
    return fs.readdirSync(directory, {withFileTypes: true}).filter(entry => entry.isFile()).map(entry => {
        const file = path.join(directory, entry.name);let stat;
        try {stat = fs.statSync(file);} catch (error) {if (error.code === 'ENOENT') return null;throw error;}
        return {file, name: entry.name, size: stat.size, identity: `${stat.dev}:${stat.ino}:${stat.birthtimeMs}`, modified: stat.mtimeMs};
    }).filter(Boolean).sort((a, b) => b.modified - a.modified || a.name.localeCompare(b.name)).slice(0, 20).reverse();
}
function readBytes(file, start, length) {
    const descriptor = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
    try {const bytes = Buffer.alloc(length);return bytes.subarray(0, fs.readSync(descriptor, bytes, 0, length, start));}
    finally {fs.closeSync(descriptor);}
}
function tail(file, lines) {
    if (!lines) return '';
    const start = Math.max(0, file.size - 65536);
    let text = readBytes(file.file, start, file.size - start).toString('utf8');
    if (start && text.includes('\n')) text = text.slice(text.indexOf('\n') + 1);
    const newline = text.endsWith('\n');
    const rows = text.split('\n');if (newline) rows.pop();
    return rows.slice(-lines).join('\n') + (newline ? '\n' : '');
}
export function readCliPluginLogs({profile, registryFile}, id, lines = 100) {
    return {pluginId: id, logs: logFiles(profile, registryFile, id).map(file => ({file: file.name, text: tail(file, lines), truncated: file.size > 65536}))};
}
export async function followCliPluginLogs(options, id, {lines = 100, write = text => process.stdout.write(text), signals = process, signal, interval = 500, wait} = {}) {
    const cursors = new Map();let firstScan = true;let lastFile;let stopped = !!signal?.aborted, wake;
    const stop = () => {stopped = true;wake?.();};
    signals.once('SIGINT', stop);signals.once('SIGTERM', stop);signal?.addEventListener('abort', stop, {once: true});
    const pause = wait || (() => new Promise(resolve => {
        const timer = setTimeout(() => {wake = undefined;resolve();}, interval);
        wake = () => {clearTimeout(timer);wake = undefined;resolve();};
    }));
    try {
        while (!stopped) {
            const files = logFiles(options.profile, options.registryFile, id), seen = new Set();
            for (const file of files) {
                seen.add(file.identity);
                let cursor = cursors.get(file.identity), text = '';
                try {
                if (!cursor) {
                    cursor = {offset: 0, decoder: new StringDecoder('utf8')};
                    if (firstScan) {text = tail(file, lines);cursor.offset = file.size;}
                    else {const bytes = readBytes(file.file, 0, Math.min(65536, file.size));cursor.offset = bytes.length;text = cursor.decoder.write(bytes);}
                    cursors.set(file.identity, cursor);
                } else {
                    if (file.size < cursor.offset) {cursor.offset = 0;cursor.decoder = new StringDecoder('utf8');}
                    if (file.size > cursor.offset) {
                        const bytes = readBytes(file.file, cursor.offset, Math.min(65536, file.size - cursor.offset));
                        cursor.offset += bytes.length;text = cursor.decoder.write(bytes);
                    }
                }
                } catch (error) {if (error.code === 'ENOENT') continue;throw error;}
                if (text) {if (lastFile !== file.name) write(`${lastFile ? '\n' : ''}[${file.name}]\n`);write(text);lastFile = file.name;}
            }
            for (const key of cursors.keys()) if (!seen.has(key)) cursors.delete(key);
            firstScan = false;
            if (!stopped) await pause();
        }
    } finally {signals.removeListener('SIGINT', stop);signals.removeListener('SIGTERM', stop);signal?.removeEventListener('abort', stop);wake?.();}
}
