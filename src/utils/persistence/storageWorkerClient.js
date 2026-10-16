import {Worker} from 'node:worker_threads';
import path from 'node:path';

export function createStorageWorker(name, workerFilename, workerData) {
    let worker;
    let failure;
    let sequence = 0;
    let closing = false;
    const pending = new Map();

    function fail(error) {
        if (failure) return;
        failure = error;
        for (const request of pending.values()) request.reject(error);
        pending.clear();
    }

    function start() {
        if (worker || failure) return;
        worker = new Worker(path.join(__dirname, workerFilename), {workerData: workerData()});
        worker.on('message', message => {
            if (message.fatal) { fail(new Error(message.error)); return; }
            const request = pending.get(message.id);
            if (!request) return;
            pending.delete(message.id);
            if (message.error) request.reject(new Error(message.error));
            else request.resolve(message.result);
            if (!pending.size) worker.unref();
        });
        worker.on('error', fail);
        worker.on('exit', code => fail(new Error(`${name} storage worker stopped (code ${code})`)));
        worker.unref();
    }

    function request(operation, value) {
        return new Promise((resolve, reject) => {
            if (closing && operation !== 'close') { reject(new Error(`${name} storage is closing`)); return; }
            start();
            if (failure) { reject(failure); return; }
            const id = ++sequence;
            pending.set(id, {resolve, reject});
            worker.ref();
            try { worker.postMessage({id, operation, value}); }
            catch (error) {
                pending.delete(id);
                if (!pending.size) worker.unref();
                reject(error);
            }
        });
    }

    function close() {
        closing = true;
        if (!worker) return Promise.resolve();
        return request('close');
    }

    return {request, close};
}
