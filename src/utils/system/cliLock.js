import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';

// SQLite's OS locks are released even if a CLI process crashes. Lock databases
// live outside workspaces, so they never enter bundles, signatures or watchers.
export async function withCliLock(resource, operation, {timeout = 30000} = {}) {
    const root = path.join(os.tmpdir(), 'fdo-cli-locks-' + createHash('sha256').update(os.homedir()).digest('hex').slice(0, 16));
    fs.mkdirSync(root, {recursive: true, mode: 0o700});
    if (fs.lstatSync(root).isSymbolicLink() || !fs.statSync(root).isDirectory()) throw new Error('Invalid CLI lock directory.');
    const absolute = path.resolve(resource);
    const canonical = fs.existsSync(absolute) ? fs.realpathSync(absolute) : path.join(fs.realpathSync(path.dirname(absolute)), path.basename(absolute));
    const key = process.platform === 'win32' ? canonical.toLowerCase() : canonical;
    const file = path.join(root, createHash('sha256').update(key).digest('hex') + '.sqlite');
    if (fs.existsSync(file) && fs.lstatSync(file).isSymbolicLink()) throw new Error('Invalid CLI lock file.');
    const db = new DatabaseSync(file);
    const started = Date.now();
    try {
        db.exec('PRAGMA busy_timeout = 0');
        for (;;) {
            try {db.exec('BEGIN IMMEDIATE');break;}
            catch (error) {
                if (!/locked|busy/i.test(error.message)) throw error;
                if (Date.now() - started >= timeout) throw new Error(`Another CLI operation is using ${resource}. Retry after it finishes.`);
                await new Promise(resolve => setTimeout(resolve, 50));
            }
        }
        try {return await operation();}
        finally {db.exec('ROLLBACK');}
    } finally {db.close();}
}
