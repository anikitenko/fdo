const {Worker} = require('node:worker_threads');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {openNotificationDatabase} = require('../../src/utils/persistence/notificationDatabase.cjs');
const {openChatDatabase} = require('../../src/utils/persistence/chatDatabase.cjs');

test.each(['notification', 'chat'])('%s worker commits queued writes before acknowledging close', async kind => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fdo-notification-worker-'));
    const filename = path.join(directory, 'notifications.sqlite');
    const worker = new Worker(path.resolve(`src/utils/persistence/${kind}Worker.cjs`), {workerData: {filename}});
    const messages = [];
    const exited = new Promise((resolve, reject) => {
        worker.on('message', message => messages.push(message));
        worker.on('error', reject);
        worker.once('exit', resolve);
    });
    try {
        const createdAt = '2026-10-16T10:00:00Z';
        worker.postMessage({id: 1, operation: kind === 'chat' ? 'put' : 'add', value: kind === 'chat'
            ? {id: 'queued', name: 'Queued chat', messages: [{id: 'message', role: 'user', content: 'Keep this', createdAt}], createdAt}
            : {id: 'queued', title: 'Queued', message: 'Keep this', type: '', read: false, createdAt}});
        worker.postMessage({id: 2, operation: 'close'});
        expect(await exited).toBe(0);
        expect(messages.map(message => message.id)).toEqual([1, 2]);
        expect(messages[1].result).toBe(true);
        const database = kind === 'chat' ? openChatDatabase(filename) : openNotificationDatabase(filename);
        try { expect(kind === 'chat' ? database.execute('get', 'queued').id : database.all()[0].id).toBe('queued'); }
        finally { database.close(); }
    } finally {
        await worker.terminate();
        fs.rmSync(directory, {recursive: true, force: true});
    }
});
