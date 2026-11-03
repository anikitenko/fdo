const PREFIX = 'fdo-os-credential:v1:';
const AUTH_RECORD = '__fdoOsCredential';
const ROOTS = ['ai.chat', 'ai.coding', 'ai.codexMcpServers', 'ai.codexMcpAuth', 'ai.codexHooks'];
const MESSAGE = 'AI credentials require an unlocked OS credential store. Unlock or configure your system keychain, then retry. Existing credentials have been preserved.';
const credentialError = () => Object.assign(new Error(MESSAGE), {code: 'AI_CREDENTIAL_STORE_LOCKED'});
const sealed = value => typeof value === 'string' && value.startsWith(PREFIX);
function canonicalKey(key) {
    if (typeof key !== 'string') return key;
    const normalized = key.replace(/\[(\d+)]/g, '.$1');
    if (normalized.includes('\\') || ((normalized === 'ai' || normalized.startsWith('ai.') || normalized.startsWith('ai[')) && /[\[\]]/.test(normalized))) {
        throw new Error('Use canonical dotted settings paths for AI credentials.');
    }
    return normalized;
}
const touchesAiCredentials = key => key === 'ai' || ROOTS.some(root => key === root || key.startsWith(root + '.'));
const secretField = key => /^ai\.(chat|coding)\.\d+\.apiKey$/.test(key)
    || /^ai\.codexMcpServers\.\d+\.(bearerToken|(headers|environment)\..+)$/.test(key)
    || /^ai\.codexHooks\.\d+\.environment\..+$/.test(key);

function publicAssistant({apiKey, ...record}) {
    return {...record, apiKey: '', hasApiKey: typeof apiKey === 'string' && !!apiKey,
        credentialMigrationPending: typeof apiKey === 'string' && !!apiKey && !sealed(apiKey)};
}

// Only the main process receives decrypted values. The backing Store and its
// internal read/modify/write operations always see OS-encrypted secret fields.
function createAiCredentialSettings(store, protection) {
    const encrypt = value => {
        let bytes;
        let verified;
        try {
            bytes = protection.encrypt(value);
            verified = Buffer.isBuffer(bytes) && bytes.length > 0 && protection.decrypt(bytes) === value;
        } catch {throw credentialError();}
        if (!verified) throw credentialError();
        return PREFIX + Buffer.from(bytes).toString('base64');
    };
    const decrypt = value => {
        const encoded = value.slice(PREFIX.length);
        if (!encoded || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throw credentialError();
        let decoded;
        try {
            decoded = protection.decrypt(Buffer.from(encoded, 'base64'));
        } catch {throw credentialError();}
        if (typeof decoded !== 'string') throw credentialError();
        return decoded;
    };
    /**
     * @param {string} key
     * @param {*} value
     * @param {boolean} [opening=false]
     * @param {true | Set<string>} [known=true]
     * @returns {*}
     */
    const transform = (key, value, opening = false, known = true) => {
        const reusable = encrypted => sealed(encrypted) && (known === true || known.has(encrypted));
        if (secretField(key)) {
            if (value == null || value === '') return value;
            if (typeof value !== 'string') throw new TypeError('AI credential values must be strings.');
            return opening ? decrypt(value) : reusable(value) ? value : encrypt(value);
        }
        if (/^ai\.codexMcpAuth\.[^.]+$/.test(key) && value && typeof value === 'object') {
            if (!Object.keys(value).length) return value;
            if (opening) {
                if (Object.keys(value).length !== 1 || !sealed(value[AUTH_RECORD])) throw credentialError();
                try {return JSON.parse(decrypt(value[AUTH_RECORD]));} catch {throw credentialError();}
            }
            return Object.keys(value).length === 1 && reusable(value[AUTH_RECORD]) ? value : {[AUTH_RECORD]: encrypt(JSON.stringify(value))};
        }
        if (Array.isArray(value)) return value.map((entry, index) => transform(`${key}.${index}`, entry, opening, known));
        if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([name, entry]) =>
            [name, transform(key ? `${key}.${name}` : name, entry, opening, known)]));
        return value;
    };
    /**
     * @param {string} key
     * @param {*} value
     * @param {true | Set<string>} [known=true]
     * @returns {*}
     */
    const protect = (key, value, known = true) => transform(key, value, false, known);
    const knownCiphertexts = () => {
        /** @type {Set<string>} */
        const known = new Set();
        const visit = (key, value) => {
            if (secretField(key) && sealed(value)) known.add(value);
            if (/^ai\.codexMcpAuth\.[^.]+$/.test(key) && value && Object.keys(value).length === 1 && sealed(value[AUTH_RECORD])) known.add(value[AUTH_RECORD]);
            if (value && typeof value === 'object') for (const [name, entry] of Object.entries(value)) visit(`${key}.${name}`, entry);
        };
        for (const key of ROOTS) visit(key, store.get(key));
        return known;
    };
    const get = (key, fallback) => {
        key = canonicalKey(key);
        const value = store.get(key, fallback);
        if (!touchesAiCredentials(key)) return value;
        const protectedValue = protect(key, value);
        // Migration is staged and round-trip verified before one atomic Store
        // write. A keychain/write failure leaves the legacy value untouched.
        if (JSON.stringify(protectedValue) !== JSON.stringify(value)) store.set(key, protectedValue);
        return transform(key, protectedValue, true);
    };
    const set = (key, value) => {
        key = key && typeof key === 'object'
            ? Object.fromEntries(Object.entries(key).map(([name, entry]) => [canonicalKey(name), entry])) : canonicalKey(key);
        if (typeof key === 'string' && !touchesAiCredentials(key)) return store.set(key, value);
        if (key && typeof key === 'object' && !Object.keys(key).some(touchesAiCredentials)) return store.set(key);
        const known = knownCiphertexts();
        if (key && typeof key === 'object') {
            return store.set(Object.fromEntries(Object.entries(key).map(([name, entry]) => [name, protect(name, entry, known)])));
        }
        // OAuth state is one encrypted record, so partial writes could otherwise
        // create an unprotected sibling beside its ciphertext.
        if (/^ai\.codexMcpAuth\.[^.]+\./.test(key)) throw new Error('Write the complete MCP authorization record.');
        return store.set(key, protect(key, value, known));
    };
    const migrate = () => {
        const patch = {};
        for (const key of ROOTS) {
            const value = store.get(key);
            if (value === undefined) continue;
            const protectedValue = protect(key, value);
            if (JSON.stringify(protectedValue) !== JSON.stringify(value)) patch[key] = protectedValue;
        }
        if (Object.keys(patch).length) store.set(patch);
        return Object.keys(patch).length;
    };
    const records = purpose => {
        if (!['chat', 'coding'].includes(purpose)) throw new Error('Invalid assistant purpose.');
        return store.get(`ai.${purpose}`, []) || [];
    };
    return new Proxy(store, {
        get(target, property) {
            if (property === 'get') return get;
            if (property === 'set') return set;
            if (property === 'migrateAiCredentials') return migrate;
            if (property === 'getAiAssistantRecords') return records;
            if (property === 'getAiAssistantMetadata') return purpose => records(purpose).map(publicAssistant);
            if (property === 'resolveAiAssistant') return (purpose, assistant) => {
                const index = records(purpose).findIndex(record => assistant.id ? record.id === assistant.id
                    : record.name === assistant.name && record.provider === assistant.provider);
                return index < 0 ? null : get(`ai.${purpose}.${index}`);
            };
            const value = Reflect.get(target, property, target);
            return typeof value === 'function' ? value.bind(target) : value;
        },
        set(target, property, value) {
            return Reflect.set(target, property, property === 'store' ? protect('', value, knownCiphertexts()) : value, target);
        },
    });
}

function assistantRecords(settings, purpose) {
    return settings.getAiAssistantRecords ? settings.getAiAssistantRecords(purpose) : settings.get(`ai.${purpose}`, []) || [];
}
function assistantMetadata(settings, purpose) {return assistantRecords(settings, purpose).map(publicAssistant);}
function assistantCredentials(settings, purpose, assistant) {
    return settings.resolveAiAssistant ? settings.resolveAiAssistant(purpose, assistant) : assistant;
}
module.exports = {createAiCredentialSettings, assistantRecords, assistantMetadata, assistantCredentials, publicAssistant, PREFIX, MESSAGE};
