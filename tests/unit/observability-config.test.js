/** @jest-environment node */
import {settings} from '../../src/utils/persistence/store';
import {publicObservabilityConfig, validateObservabilityConfig, langfuseConfig, DEFAULT_RETENTION} from '../../src/utils/persistence/observabilityConfig';
import {encryptDiagnostic} from '../../src/utils/persistence/osProtection';
import {stageObservabilityMigration} from '../../src/utils/persistence/stageObservabilityMigration.cjs';
jest.mock('../../src/utils/persistence/store', () => ({settings: {get: jest.fn(), set: jest.fn()}}));
jest.mock('../../src/utils/persistence/osProtection', () => ({encryptDiagnostic: jest.fn(value => Buffer.from(JSON.stringify(value))), decryptDiagnostic: jest.fn(value => JSON.parse(value.toString()))}));
let config;
const input = () => ({localTracing: true, captureContent: false, retention: {...DEFAULT_RETENTION}, langfuse: {enabled: true, host: 'https://cloud.langfuse.com', publicKey: 'pk-lf-example', secretKey: 'private-key', environment: 'production', release: ''}});
beforeEach(() => {config = {}; settings.get.mockImplementation((_key, fallback) => Object.keys(config).length ? config : fallback); settings.set.mockImplementation((_key, value) => {config = value;});});
afterEach(() => {for (const field of ['LANGFUSE_ENABLED', 'LANGFUSE_HOST', 'LANGFUSE_PUBLIC_KEY', 'LANGFUSE_SECRET_KEY']) delete process.env[field]; jest.clearAllMocks();});
test('saves encrypted secrets, returns only public configuration, and preserves or explicitly clears a saved key', () => {
    validateObservabilityConfig(input(), {save: true});
    expect(config.langfuse).not.toHaveProperty('secretKey');
    expect(publicObservabilityConfig().langfuse).toMatchObject({hasSecretKey: true});
    expect(publicObservabilityConfig().effectiveLangfuse).not.toHaveProperty('encryptedSecretKey');
    expect(publicObservabilityConfig().effectiveLangfuse).not.toHaveProperty('secretKey');
    validateObservabilityConfig({...input(), langfuse: {...input().langfuse, secretKey: ''}}, {save: true});
    expect(langfuseConfig().secretKey).toBe('private-key');
    validateObservabilityConfig({...input(), localTracing: false, langfuse: {...input().langfuse, enabled: false, secretKey: '', clearSecret: true}}, {save: true});
    expect(publicObservabilityConfig().langfuse.hasSecretKey).toBe(false);
});
test('environment overrides are explicit and never expose secret values', () => {
    process.env.LANGFUSE_HOST = 'https://env.example'; process.env.LANGFUSE_SECRET_KEY = 'environment-secret';
    const result = publicObservabilityConfig();
    expect(result.effectiveLangfuse).toMatchObject({host: 'https://env.example', overridden: ['host', 'secretKey'], hasSecretKey: true});
    expect(JSON.stringify(result)).not.toContain('environment-secret');
});
// noinspection HttpUrlsUsage -- Insecure URLs are intentional rejection fixtures.
test.each(['file:///tmp/example', 'https://user:pass@example.com', 'http://example.com', 'https://example.com/?token=secret'])('rejects unsafe or ambiguous host %s', host => {
    expect(() => validateObservabilityConfig({...input(), langfuse: {...input().langfuse, host}})).toThrow();
});
test('invalid retention and unavailable protection cannot overwrite settings', () => {
    expect(() => validateObservabilityConfig({...input(), retention: {...DEFAULT_RETENTION, traceDays: 0}})).toThrow('Retention');
    encryptDiagnostic.mockImplementationOnce(() => {throw new Error('Keychain locked');});
    expect(() => validateObservabilityConfig(input(), {save: true})).toThrow('Keychain locked');
    expect(settings.set).not.toHaveBeenCalled();
});
test('schema migration stages existing data and removes only historical fields and the old secret', () => {
    const values = {ai: {metrics: {tokens: {requests: 2}}, usageLedger: [{id: 'request'}], usageRates: {custom: 1}, observability: {langfuse: {secretKey: 'old-secret', host: 'https://example.com'}}}};
    const store = {get: (key, fallback) => key === 'ai' ? values.ai : values[key] ?? fallback,
        set(key, value) {if (key === 'ai.observability.langfuse') values.ai.observability.langfuse = value; else values[key] = value;},
        delete(key) {delete values.ai[key.slice(3)];}};
    stageObservabilityMigration(store);
    expect(values.observabilityMigration).toMatchObject({metrics: {tokens: {requests: 2}}, usageLedger: [{id: 'request'}], secretKey: 'old-secret'});
    expect(values.ai).not.toHaveProperty('metrics'); expect(values.ai).not.toHaveProperty('usageLedger');
    expect(values.ai.observability.langfuse).not.toHaveProperty('secretKey'); expect(values.ai.usageRates).toEqual({custom: 1});
});
