import fs from 'node:fs';
import path from 'node:path';
import {readCliRegistry} from './cliPluginOperations';

export function listCliProfiles(baseDirectory, current = 'default') {
    const base = path.resolve(baseDirectory), profiles = path.join(base, 'profiles');
    const names = ['default'];
    if (fs.existsSync(profiles)) {
        if (fs.lstatSync(profiles).isSymbolicLink()) throw new Error('Profile directory must not be a symlink.');
        names.push(...fs.readdirSync(profiles, {withFileTypes: true}).filter(entry => entry.isDirectory() && entry.name !== 'default' && /^[a-z0-9][a-z0-9_-]{0,47}$/.test(entry.name)).map(entry => entry.name).sort());
    }
    return names.map(name => {
        const directory = name === 'default' ? base : path.join(profiles, name);
        try {return {name, directory, current: name === current, pluginCount: readCliRegistry(path.join(directory, 'plugins.json')).plugins.length};}
        catch (error) {return {name, directory, current: name === current, pluginCount: null, error: error.message};}
    });
}
