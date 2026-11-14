import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';

// A failed read is never an empty registry. Commit synchronously after re-reading
// so renderer mutations cannot interleave with the compare-and-swap in this process.
export function createRegistryInstallStore(file) {
    const read = () => {
        let data;
        try {data = JSON.parse(fs.readFileSync(file, 'utf8'));}
        catch (error) {if (error.code === 'ENOENT') return {plugins: []}; throw error;}
        if (!Array.isArray(data.plugins)) throw new Error('The plugin registry is invalid. Restore it before installing plugins.');
        return data;
    };
    return {
        file,
        all: () => read().plugins,
        get: id => read().plugins.find(plugin => plugin.id === id) || null,
        commit(id, expected, replacement) {
            const data = read(), current = data.plugins.find(plugin => plugin.id === id) || null;
            if (JSON.stringify(current) !== JSON.stringify(expected || null))
                throw Object.assign(new Error('This plugin changed while installation was open. Review the current installation and try again.'), {code: 'REGISTRY_INSTALL_CONFLICT'});
            if (replacement && replacement.id !== id) throw new Error('Installation identity does not match its registry record.');
            data.plugins = replacement ? [...data.plugins.filter(plugin => plugin.id !== id), replacement] : data.plugins.filter(plugin => plugin.id !== id);
            fs.mkdirSync(path.dirname(file), {recursive: true});
            const temporary = `${file}.${randomUUID()}.tmp`;
            let fd;
            try {
                fd = fs.openSync(temporary, 'wx', 0o600);
                fs.writeFileSync(fd, JSON.stringify(data, null, 4));
                fs.fsyncSync(fd); fs.closeSync(fd); fd = undefined;
                fs.renameSync(temporary, file);
                // Directory fsync is unavailable on some platforms. File contents
                // are flushed before the atomic rename in all cases.
                if (process.platform !== 'win32') {
                    let directory;
                    try {directory = fs.openSync(path.dirname(file), 'r'); fs.fsyncSync(directory);}
                    catch (error) {console.error('Could not flush the plugin registry directory:', error.code);}
                    finally {if (directory !== undefined) fs.closeSync(directory);}
                }
            } finally {if (fd !== undefined) fs.closeSync(fd); fs.rmSync(temporary, {force: true});}
            return replacement;
        },
    };
}
