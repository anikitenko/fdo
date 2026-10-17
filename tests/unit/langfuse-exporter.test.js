/** @jest-environment node */
import {createLangfuseExporter} from '../../src/ipc/ai/langfuseExporter';
import {exportDestination} from '../../src/utils/persistence/observabilityConfig';
jest.mock('../../src/utils/persistence/store', () => ({settings: {get: jest.fn()}}));
let config, request, fetchImpl, exporter, payload;
beforeEach(() => {
    config = {enabled: true, host: 'https://example.com', publicKey: 'pk', secretKey: 'private'};
    payload = {otel: {resourceSpans: []}};
    request = jest.fn(async operation => operation === 'due' ? [{id: 'trace', attempts: 0, payload}] : true);
    fetchImpl = jest.fn(async () => ({ok: true, status: 200, json: async () => ({})}));
    exporter = createLangfuseExporter({request, config: () => config, decrypt: value => value, fetchImpl, now: () => 1000});
});
test('uses the supported OTLP endpoint, acknowledges only accepted work, and includes the v4 header', async () => {
    await exporter.run();
    expect(fetchImpl).toHaveBeenCalledWith('https://example.com/api/public/otel/v1/traces', expect.objectContaining({headers: expect.objectContaining({'x-langfuse-ingestion-version': '4'}), body: JSON.stringify(payload.otel)}));
    expect(request).toHaveBeenCalledWith('export-result', expect.objectContaining({state: 'sent', destination: exportDestination(config)}));
});
test('retries transient failures with backoff without persisting server responses or secrets', async () => {
    fetchImpl.mockRejectedValueOnce(new Error('private response including secret'));
    await exporter.run();
    const result = request.mock.calls.find(([operation]) => operation === 'export-result')[1];
    expect(result).toMatchObject({state: 'pending', attempts: 1, nextAttemptAt: 16000});
    expect(JSON.stringify(result)).not.toMatch(/private|secret/);
});
test('authentication failures wait for manual retry and partial success is not acknowledged as complete', async () => {
    fetchImpl.mockResolvedValueOnce({ok: false, status: 401}); await exporter.run();
    expect(request).toHaveBeenCalledWith('export-result', expect.objectContaining({state: 'failed', error: 'Langfuse returned HTTP 401'}));
    request.mockClear(); fetchImpl.mockResolvedValueOnce({ok: true, json: async () => ({partialSuccess: {rejectedSpans: 1}})});
    await exporter.run(); expect(request).toHaveBeenCalledWith('export-result', expect.objectContaining({state: 'pending'}));
});
test('disabled export makes no requests and a changed destination cannot receive an older queued trace', async () => {
    config.enabled = false; await exporter.run(); expect(request).not.toHaveBeenCalled();
    config.enabled = true;
    request.mockImplementationOnce(async () => {config = {...config, publicKey: 'another-project'}; return [{id: 'trace', payload}];});
    await exporter.run(); expect(fetchImpl).not.toHaveBeenCalled();
});
