/** @jest-environment node */
jest.mock('../../src/utils/persistence/store', () => ({settings: {path: '/tmp/settings.json', get: jest.fn(), set: jest.fn(), delete: jest.fn()}}));
jest.mock('../../src/utils/persistence/osProtection', () => ({encryptDiagnostic: jest.fn(value => Buffer.from(JSON.stringify(value))), decryptDiagnostic: jest.fn(value => JSON.parse(Buffer.from(value).toString()))}));
jest.mock('../../src/utils/persistence/storageWorkerClient', () => ({createStorageWorker: jest.fn()}));

let storage, request, close, settings;
beforeEach(() => {
    jest.resetModules();
    settings = require('../../src/utils/persistence/store').settings;
    settings.get.mockImplementation((key, fallback) => key === 'observabilityMigration' ? {metrics: {tokens: {requests: 5}, retrieval: {recentMisses: []}}, usageLedger: []} : fallback);
    request = jest.fn(async operation => operation === 'metrics' ? {totals: {tokens: {requests: 5}}, misses: []} : true);
    close = jest.fn(async () => {});
    require('../../src/utils/persistence/storageWorkerClient').createStorageWorker.mockReturnValue({request, close});
    storage = require('../../src/utils/persistence/observabilityStorage');
});
afterEach(async () => {await storage.closeObservabilityStorage().catch(() => {});});
test('coalesces metric snapshots, batches writes, and drains an accounting write before closing the worker', async () => {
    await storage.initializeObservabilityStorage();
    expect(settings.delete).toHaveBeenCalledWith('observabilityMigration');
    storage.saveAiMetrics({tokens: {requests: 6}, retrieval: {recentMisses: []}});
    storage.saveAiMetrics({tokens: {requests: 7}, retrieval: {recentMisses: []}});
    storage.recordRuntimeSamples({createdAt: Date.now(), metrics: []});
    const writing = storage.saveUsageEntry({id: 'request', startedAt: new Date().toISOString()});
    await writing;
    await storage.closeObservabilityStorage();
    const batches = request.mock.calls.filter(([operation]) => operation === 'batch').flatMap(([, records]) => records);
    expect(batches.filter(record => record.kind === 'metrics')).toHaveLength(1);
    expect(batches.find(record => record.kind === 'metrics').value.totals.tokens.requests).toBe(7);
    expect(batches.filter(record => record.kind === 'usage')).toHaveLength(1);
    expect(close).toHaveBeenCalled();
    expect(settings.set).not.toHaveBeenCalledWith('ai.metrics', expect.anything());
});
test('failed migration never removes the staged settings data', async () => {
    request.mockImplementation(async () => {throw new Error('Disk full');});
    await expect(storage.initializeObservabilityStorage()).rejects.toThrow('Disk full');
    expect(settings.delete).not.toHaveBeenCalled();
});
