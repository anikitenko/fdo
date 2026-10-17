import path from 'node:path';
import {settings} from './store';
import {createStorageWorker} from './storageWorkerClient';
import {createIncidentReporter} from '../desktop/backgroundNotifications';

const client = createStorageWorker('Chat', 'chatWorker.cjs', () => ({
    filename: path.join(path.dirname(settings.path), 'chat-history.sqlite'),
}));
const incident = createIncidentReporter({source: 'ai', groupKey: 'ai-chat-storage', title: 'AI conversation history is unavailable',
    message: 'This history operation could not complete. Your latest conversation changes may not be saved. Check disk space and file access, then restart FDO.',
    recoveredTitle: 'AI conversation history is available again', recoveredMessage: 'Conversation history can be read and saved again. Check the conversation for any changes made during the failure.',
    actions: [{kind: 'view-settings', tab: 'observability'}]});
const request = async (operation, value) => {
    try {const result = await (value === undefined ? client.request(operation) : client.request(operation, value)); incident.recover(); return result;}
    catch (error) {incident.fail(error); throw error;}
};

export const chatStorage = {
    ready: () => request('ready'),
    list: () => request('list'),
    summaries: () => request('summaries'),
    get: id => request('get', id),
    put: session => request('put', session),
    create: session => request('create', session),
    rename: (id, name) => request('rename', {id, name, updatedAt: new Date().toISOString()}),
};
export const closeChatStorage = client.close;
