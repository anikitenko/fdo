import {createHash} from 'node:crypto';
import {settings} from './store';
import {encryptDiagnostic, decryptDiagnostic} from './osProtection';

export const DEFAULT_RETENTION = {runtimeDays: 7, diagnosticsDays: 30, traceDays: 30, usageDays: 365};
const ENV_FIELDS = {enabled: 'LANGFUSE_ENABLED', host: 'LANGFUSE_HOST', publicKey: 'LANGFUSE_PUBLIC_KEY', secretKey: 'LANGFUSE_SECRET_KEY', environment: 'LANGFUSE_ENV', release: 'LANGFUSE_RELEASE'};
export function storedObservabilityConfig() {
    const stored = settings.get('ai.observability', {}) || {};
    return {...stored, localTracing: !!stored.localTracing, captureContent: !!stored.captureContent,
        retention: {...DEFAULT_RETENTION, ...stored.retention},
        langfuse: {enabled: false, host: '', publicKey: '', environment: 'production', release: '', ...stored.langfuse}};
}
export function langfuseConfig({decrypt = true, candidate} = {}) {
    const config = {...(candidate || storedObservabilityConfig()).langfuse};
    const overridden = [];
    for (const [field, variable] of Object.entries(ENV_FIELDS)) {
        if (process.env[variable] !== undefined) {
            overridden.push(field);
            config[field] = field === 'enabled' ? /^(1|true|yes|on)$/i.test(process.env[variable].trim()) : process.env[variable].trim();
        }
    }
    if (decrypt && !overridden.includes('secretKey')) config.secretKey = config.encryptedSecretKey ? decryptDiagnostic(Buffer.from(config.encryptedSecretKey, 'base64')) : '';
    config.host = String(config.host || '').replace(/\/+$/, '');
    config.hasSecretKey = !!(config.encryptedSecretKey || config.secretKey);
    config.overridden = overridden;
    return config;
}
export function publicObservabilityConfig() {
    const stored = storedObservabilityConfig();
    const {encryptedSecretKey, secretKey, ...effective} = langfuseConfig({decrypt: false});
    const {encryptedSecretKey: ignored, ...publicStored} = stored.langfuse;
    return {...stored, langfuse: {...publicStored, hasSecretKey: !!encryptedSecretKey}, effectiveLangfuse: effective};
}
export function exportDestination(config) {
    return createHash('sha256').update(`${config.host}\n${config.publicKey}`).digest('hex');
}
function cleanString(value, maximum) {
    if (typeof value !== 'string' || value.length > maximum) throw new Error('Invalid observability configuration');
    return value.trim();
}
export function validateObservabilityConfig(input, {save = false} = {}) {
    if (!input || typeof input !== 'object') throw new Error('Invalid observability configuration');
    const previous = storedObservabilityConfig();
    const next = {...previous, langfuse: {...previous.langfuse}, retention: {...previous.retention}};
    for (const field of ['localTracing', 'captureContent']) {
        if (typeof input[field] !== 'boolean') throw new Error('Choose tracing and content capture preferences');
        next[field] = input[field];
    }
    for (const field of Object.keys(DEFAULT_RETENTION)) {
        const value = input.retention?.[field];
        if (!Number.isInteger(value) || value < 1 || value > 365) throw new Error('Retention must be between 1 and 365 days');
        next.retention[field] = value;
    }
    if (typeof input.langfuse?.enabled !== 'boolean') throw new Error('Choose whether Langfuse export is enabled');
    next.langfuse.enabled = input.langfuse.enabled;
    for (const [field, max] of [['host', 2048], ['publicKey', 512], ['environment', 100], ['release', 200]]) next.langfuse[field] = cleanString(input.langfuse[field] ?? '', max);
    next.langfuse.host = next.langfuse.host.replace(/\/+$/, '');
    if (next.langfuse.host) {
        let url;
        try {url = new URL(next.langfuse.host);} catch {throw new Error('Enter a valid Langfuse base URL, such as https://cloud.langfuse.com');}
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('Use an HTTP or HTTPS base URL without credentials, query parameters, or fragments');
        if (url.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error('Use HTTPS for a remote Langfuse server');
    }
    next.langfuse.environment ||= 'production';
    if (input.langfuse.clearSecret) next.langfuse.encryptedSecretKey = null;
    if (input.langfuse.secretKey) {
        const secret = cleanString(input.langfuse.secretKey, 2048);
        const encrypted = encryptDiagnostic(secret);
        if (decryptDiagnostic(encrypted) !== secret) throw new Error('Could not verify encrypted Langfuse secret');
        next.langfuse.encryptedSecretKey = encrypted.toString('base64');
    }
    const enabled = langfuseConfig({candidate: next, decrypt: false}).enabled;
    const effective = langfuseConfig({candidate: next, decrypt: !!enabled});
    if (effective.enabled && (!effective.host || !effective.publicKey || !effective.secretKey)) throw new Error('Langfuse export requires a server URL, public key, and secret key');
    if (next.localTracing || effective.enabled) encryptDiagnostic('protection-check');
    if (save) settings.set('ai.observability', next);
    return next;
}
