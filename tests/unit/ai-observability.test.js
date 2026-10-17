/** @jest-environment node */
import {createAiObservabilityTrace} from '../../src/ipc/ai/observability';
import {storedObservabilityConfig, langfuseConfig} from '../../src/utils/persistence/observabilityConfig';
import {saveTrace} from '../../src/utils/persistence/observabilityStorage';
jest.mock('../../src/utils/persistence/observabilityConfig', () => ({storedObservabilityConfig: jest.fn(), langfuseConfig: jest.fn(), exportDestination: () => 'project'}));
jest.mock('../../src/utils/persistence/observabilityStorage', () => ({saveTrace: jest.fn(async () => true)}));
beforeEach(() => {jest.clearAllMocks(); storedObservabilityConfig.mockReturnValue({localTracing: true, captureContent: false}); langfuseConfig.mockReturnValue({enabled: false});});
test('local tracing works without export and excludes prompt, response, tool and sensitive metadata content by default', async () => {
    const trace = createAiObservabilityTrace({input: 'private prompt', metadata: {query: 'private query', provider: 'openai'}});
    const span = trace.startSpan('tool', {input: 'private tool'}); span.finish({output: 'private output'});
    await trace.finish({output: 'private response'}); await trace.finish();
    expect(saveTrace).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(saveTrace.mock.calls[0][0])).not.toContain('private');
    expect(saveTrace.mock.calls[0][0].otel.resourceSpans[0].scopeSpans[0].spans).toHaveLength(2);
    expect(saveTrace.mock.calls[0][1]).toBeNull();
});
test('explicit content capture includes bounded input/output, redacts credential fields, and creates export work', async () => {
    storedObservabilityConfig.mockReturnValue({localTracing: true, captureContent: true}); langfuseConfig.mockReturnValue({enabled: true});
    const trace = createAiObservabilityTrace({input: {text: 'my prompt', apiKey: 'credential'}, metadata: {secretKey: 'another-credential'}});
    await trace.fail(new Error('tool failed'));
    const record = saveTrace.mock.calls[0][0];
    expect(JSON.stringify(record)).toContain('my prompt'); expect(JSON.stringify(record)).not.toContain('credential');
    expect(record.status).toBe('failed'); expect(saveTrace.mock.calls[0][1]).toBe('project');
});
test('disabled recording and exporting produce no local history', async () => {
    storedObservabilityConfig.mockReturnValue({localTracing: false});
    const trace = createAiObservabilityTrace(); await trace.finish(); expect(saveTrace).not.toHaveBeenCalled();
});
