/** @jest-environment node */
const crypto = require('node:crypto');
const {createAiCredentialSettings, assistantMetadata, assistantRecords, assistantCredentials, PREFIX} = require('../../src/utils/persistence/aiCredentialSettings.cjs');

function fixture(ai = {}) {
    let data = {ai: structuredClone(ai), theme: 'dark'};
    const at = key => key.split('.').reduce((value, part) => value?.[part], data);
    const raw = {
        get: (key, fallback) => structuredClone(at(key) ?? fallback),
        set: jest.fn((key, value) => {
            const patch = typeof key === 'object' ? key : {[key]: value};
            const next = structuredClone(data);
            for (const [name, entry] of Object.entries(patch)) {
                const parts = name.split('.');let current = next;
                for (const part of parts.slice(0, -1)) current = current[part] ??= {};
                current[parts.at(-1)] = structuredClone(entry);
            }
            data = next;
        }),
        get store() {return structuredClone(data);},
        set store(value) {data = structuredClone(value);},
        rewriteTheme(value) {this.set('theme', value);},
    };
    const key = crypto.randomBytes(32);
    const protection = {
        encrypt: jest.fn(value => {
            const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
            return Buffer.concat([iv, cipher.update(value, 'utf8'), cipher.final(), cipher.getAuthTag()]);
        }),
        decrypt: jest.fn(bytes => {
            const decipher = crypto.createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12));
            decipher.setAuthTag(bytes.subarray(-16));
            return Buffer.concat([decipher.update(bytes.subarray(12, -16)), decipher.final()]).toString('utf8');
        }),
    };
    return {raw, protection, settings: createAiCredentialSettings(raw, protection)};
}
const legacy = () => ({
    chat: [{id:'chat', name:'Chat', provider:'openai', apiKey:'synthetic-chat-key'}],
    coding: [{id:'code', name:'Coding', provider:'openrouter', apiKey:'synthetic-coding-key'}],
    codexMcpServers: [{id:'mcp', bearerToken:'synthetic-bearer', headers:{Authorization:'synthetic-header'}, environment:{TOKEN:'synthetic-mcp-env'}}],
    codexMcpAuth: {mcp:{tokens:{access_token:'synthetic-access', refresh_token:'synthetic-refresh'}, client:{client_secret:'synthetic-client-secret'}}},
    codexHooks: [{id:'hook', environment:{TOKEN:'synthetic-hook-env'}}],
});

test('migrates all saved AI secret fields atomically and hydrates them only for main-process use', () => {
    const initial = legacy(), {settings, raw} = fixture(initial);
    expect(settings.migrateAiCredentials()).toBe(5);
    const serialized = JSON.stringify(raw.store);
    for (const key of ['synthetic-chat-key','synthetic-coding-key','synthetic-bearer','synthetic-header','synthetic-mcp-env','synthetic-access','synthetic-refresh','synthetic-client-secret','synthetic-hook-env']) expect(serialized).not.toContain(key);
    expect(settings.get('ai')).toEqual(initial);
    expect(raw.get('ai.chat.0.apiKey')).toMatch(/^fdo-os-credential:v1:/);
    expect(settings.migrateAiCredentials()).toBe(0);
});

test('metadata does not unlock the keychain or expose plaintext/ciphertext, while selected providers receive the key', () => {
    const {settings, protection} = fixture(legacy());settings.migrateAiCredentials();
    protection.decrypt.mockClear();protection.encrypt.mockClear();
    const metadata = assistantMetadata(settings, 'chat');
    expect(metadata[0]).toMatchObject({apiKey:'',hasApiKey:true,credentialMigrationPending:false});
    expect(JSON.stringify(metadata)).not.toContain(PREFIX);
    expect(protection.decrypt).not.toHaveBeenCalled();
    expect(assistantCredentials(settings,'chat',metadata[0]).apiKey).toBe('synthetic-chat-key');
});

test('metadata-only updates preserve existing ciphertext without requiring a keychain operation', () => {
    const {settings, raw, protection} = fixture(legacy());settings.migrateAiCredentials();
    const encrypted = raw.get('ai.coding.0.apiKey');
    protection.encrypt.mockImplementation(() => {throw new Error('locked');});
    protection.decrypt.mockImplementation(() => {throw new Error('locked');});
    settings.set('ai.coding', assistantRecords(settings,'coding').map(record => ({...record,default:true})));
    expect(raw.get('ai.coding.0.apiKey')).toBe(encrypted);
    expect(raw.get('ai.coding.0.default')).toBe(true);
});

test('locked-store migration and new saves fail closed without changing legacy credentials', () => {
    const {settings, raw, protection} = fixture(legacy());const before = raw.store;
    protection.encrypt.mockImplementation(() => {throw new Error('provider leaked synthetic-chat-key');});
    expect(() => settings.migrateAiCredentials()).toThrow('Existing credentials have been preserved');
    expect(raw.store).toEqual(before);
    expect(() => settings.get('ai.chat')).toThrow('OS credential store');
    expect(() => settings.set('ai.chat.0.apiKey','new-private-key')).toThrow('OS credential store');
    expect(raw.store).toEqual(before);
    expect(assistantMetadata(settings,'chat')[0]).toMatchObject({apiKey:'',hasApiKey:true,credentialMigrationPending:true});
});

test('failed encryption verification or persistence leaves the original data unchanged', () => {
    const {settings, raw, protection} = fixture(legacy());const before = raw.store;
    protection.decrypt.mockReturnValue('wrong value');
    expect(() => settings.migrateAiCredentials()).toThrow('OS credential store');expect(raw.store).toEqual(before);
    const next = fixture(legacy());next.raw.set.mockImplementation(() => {throw new Error('disk full');});
    expect(() => next.settings.migrateAiCredentials()).toThrow('disk full');expect(next.raw.store).toEqual(before);
});

test('corrupt encrypted data is rejected without a plaintext fallback', () => {
    const {settings, raw} = fixture({chat:[{id:'chat',apiKey:PREFIX+'corrupt'}]});
    expect(() => settings.get('ai.chat')).toThrow('OS credential store');
    expect(raw.get('ai.chat.0.apiKey')).toBe(PREFIX+'corrupt');
});

test('bulk/root writes protect secrets and internal Store operations never persist decrypted keys', () => {
    const {settings, raw} = fixture();settings.set({ai:legacy(), theme:'light'});
    settings.rewriteTheme('dark');expect(raw.get('ai.chat.0.apiKey')).toMatch(/^fdo-os-credential:v1:/);
    settings.store = {ai:legacy()};expect(JSON.stringify(raw.store)).not.toContain('synthetic-chat-key');
    expect(() => settings.set('ai.codexMcpAuth.mcp.tokens.access_token','unsafe')).toThrow('complete MCP');
});

test('keyless assistants and unrelated settings remain available while the keychain is locked', () => {
    const {settings, raw, protection} = fixture({coding:[{id:'local',provider:'ollama',apiKey:''}]});
    protection.encrypt.mockImplementation(() => {throw new Error('locked');});
    expect(settings.get('ai.coding')[0].apiKey).toBe('');
    settings.set('theme','light');expect(raw.get('theme')).toBe('light');
});

test('new values cannot bypass encryption by imitating the storage prefix or OAuth envelope', () => {
    const {settings, raw} = fixture();const token = PREFIX+'literal-new-token';
    settings.set('ai.chat',[{id:'chat',apiKey:token}]);
    expect(raw.get('ai.chat.0.apiKey')).not.toBe(token);
    expect(settings.get('ai.chat.0.apiKey')).toBe(token);
    settings.set('ai.codexMcpAuth',{mcp:{__fdoOsCredential:PREFIX+'fake',tokens:{access_token:'synthetic-access'}}});
    expect(JSON.stringify(raw.get('ai.codexMcpAuth'))).not.toContain('synthetic-access');
    expect(settings.get('ai.codexMcpAuth').mcp.tokens.access_token).toBe('synthetic-access');
});

test('array-path aliases cannot bypass protected writes and ambiguous AI paths are rejected', () => {
    const {settings, raw} = fixture({chat:[{id:'chat',apiKey:''}]});
    settings.set('ai.chat[0].apiKey','alias-secret');
    expect(raw.get('ai.chat.0.apiKey')).toMatch(/^fdo-os-credential:v1:/);
    expect(settings.get('ai.chat[0].apiKey')).toBe('alias-secret');
    settings.set({'ai.chat[0].apiKey':'bulk-alias-secret'});
    expect(settings.get('ai.chat.0.apiKey')).toBe('bulk-alias-secret');
    expect(() => settings.set('ai["chat"][0]["apiKey"]','unsafe')).toThrow('canonical dotted');
    expect(() => settings.set('a\\i.chat.0.apiKey','unsafe')).toThrow('canonical dotted');
    expect(JSON.stringify(raw.store)).not.toContain('bulk-alias-secret');
});
