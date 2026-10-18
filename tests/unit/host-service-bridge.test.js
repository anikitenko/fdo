/** @jest-environment node */
const {expect, jest: mock, test} = require('@jest/globals');
const {EventEmitter} = require('node:events');
const {attachHostServiceBridge, REQUEST, RESPONSE, DISCONNECT} = require('../../src/utils/hostServices/workerBridge.cjs');
const {randomUUID} = require('node:crypto');

test('authenticates through the bound endpoint, returns direct results and rejects forged identities', async () => {
    const child = new EventEmitter(); child.postMessage = mock.fn();
    const endpoint = {request: mock.fn(async () => ({value: 'backend-only'})), close: mock.fn()};
    const close = attachHostServiceBridge(child, endpoint);
    const requestId = randomUUID(), request = {action: 'secrets.get', payload: {key: 'token'}};
    child.emit('message', {type: REQUEST, requestId, request, pluginId: 'victim'});
    expect(endpoint.request).not.toHaveBeenCalled();
    expect(child.postMessage.mock.calls[0][0]).toEqual({message: RESPONSE, content: {requestId, error: 'INVALID_REQUEST'}});
    child.emit('message', {type: REQUEST, requestId, request}); await Promise.resolve();
    expect(endpoint.request.mock.calls[0]).toEqual([request, requestId]);
    expect(child.postMessage.mock.calls.at(-1)[0]).toEqual({message: RESPONSE, content: {requestId, result: {value: 'backend-only'}}});
    close(); expect(endpoint.close).toHaveBeenCalledTimes(1);
    expect(child.listenerCount('message')).toBe(0);
});

test('SDK clearPlugin closes only its authenticated endpoint', () => {
    const child = new EventEmitter(); child.postMessage = mock.fn();
    const endpoint = {request: mock.fn(), close: mock.fn()};
    attachHostServiceBridge(child, endpoint);
    child.emit('message', {type: DISCONNECT, pluginId: 'other'});
    expect(endpoint.close).not.toHaveBeenCalled();
    child.emit('message', {type: DISCONNECT});
    expect(endpoint.close).toHaveBeenCalledTimes(1);
    expect(child.listenerCount('message')).toBe(0);
});

test('bounds pending requests and suppresses replies after worker exit', async () => {
    const child = new EventEmitter(); child.postMessage = mock.fn();
    let finish;
    const endpoint = {request: mock.fn(() => new Promise(resolve => {finish = resolve;})), close: mock.fn()};
    attachHostServiceBridge(child, endpoint);
    const request = {action: 'secrets.list', payload: {}};
    for (let i = 0; i < 25; i++) child.emit('message', {type: REQUEST, requestId: randomUUID(), request});
    expect(endpoint.request).toHaveBeenCalledTimes(24);
    expect(child.postMessage.mock.calls[0][0].content.error).toBe('INVALID_REQUEST');
    child.emit('exit'); finish({entries: []}); await Promise.resolve();
    expect(child.postMessage).toHaveBeenCalledTimes(1);
    expect(endpoint.close).toHaveBeenCalledTimes(1);
});

test('provider messages are never included in error responses', async () => {
    const child = new EventEmitter(); child.postMessage = mock.fn();
    const close = attachHostServiceBridge(child, {request: async () => {throw new Error('password=private');}, close() {}});
    child.emit('message', {type: REQUEST, requestId: randomUUID(), request: {action: 'secrets.list', payload: {}}});
    await Promise.resolve();
    expect(child.postMessage.mock.calls[0][0].content.error).toBe('UNAVAILABLE');
    expect(JSON.stringify(child.postMessage.mock.calls)).not.toContain('password'); close();
});

test('shutdown barrier awaits only the matching worker acknowledgement and cleans up on timeout',async()=>{
    const {drainWorkerStorage}=require('../../src/utils/hostServices/workerBridge.cjs');
    const child=new EventEmitter();child.postMessage=mock.fn();
    const pending=drainWorkerStorage(child,100);
    const requestId=child.postMessage.mock.calls[0][0].content.requestId;
    child.emit('message',{type:'HOST_STORAGE_SHUTDOWN_REPLY_V1',requestId:'forged',success:true});
    child.emit('message',{type:'HOST_STORAGE_SHUTDOWN_REPLY_V1',requestId,success:true});
    await expect(pending).resolves.toEqual({success:true});
    await expect(drainWorkerStorage(child,5)).resolves.toEqual({success:false});
    expect(child.listenerCount('message')).toBe(0);
});
