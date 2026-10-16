import fs from 'node:fs';
import path from 'node:path';
import {settings} from './store';
import {createStorageWorker} from './storageWorkerClient';

let legacy;
let initialization;
const client = createStorageWorker('Chat', 'chatWorker.cjs', () => ({
    filename: path.join(path.dirname(settings.path), 'chat-history.sqlite'), legacy,
}));

export function initializeChatStorage() {
    if (!initialization) initialization = (async () => {
        legacy = settings.get('ai.sessions', []) || [];
        await client.request('ready'); // Import must commit before changing JSON.
        if (legacy.length) {
            const backup = path.join(path.dirname(settings.path), 'settings-before-chat-sqlite.json');
            try {
                fs.copyFileSync(settings.path, backup, fs.constants.COPYFILE_EXCL);
                fs.chmodSync(backup, 0o600);
            }
            catch (error) { if (error.code !== 'EEXIST') throw error; }
            settings.delete('ai.sessions');
        }
        legacy = null;
    })();
    return initialization;
}

async function request(operation, value) {
    await initializeChatStorage();
    return client.request(operation, value);
}

export const chatStorage = {
    list: () => request('list'),
    summaries: () => request('summaries'),
    get: id => request('get', id),
    put: session => request('put', session),
    create: session => request('create', session),
    rename: (id, name) => request('rename', {id, name, updatedAt: new Date().toISOString()}),
};

export async function closeChatStorage() {
    // Initialization may still be copying the backup; let it finish first.
    try { if (initialization) await initialization; }
    finally { await client.close(); }
}
