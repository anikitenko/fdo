const providerPattern = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,199}$/;
const servicePattern = /^[a-z][a-z0-9-]{0,63}$/;
const methodPattern = /^[a-zA-Z][a-zA-Z0-9_]{0,63}$/;
const blocked = new Set(['constructor', 'prototype', '__proto__', 'then']);
const codes = new Set(['ACCESS_DENIED','UNAVAILABLE','INVALID_REQUEST','TIMEOUT','CANCELLED','BACKPRESSURE','NOT_FOUND','CONFLICT','SERVICE_ERROR']);
function error(code) {return Object.assign(new Error(`Shared logic request failed (${codes.has(code) ? code : 'SERVICE_ERROR'}).`), {code: codes.has(code) ? code : 'SERVICE_ERROR'});}
function ensure(condition, code = 'INVALID_REQUEST') {if (!condition) throw error(code);}
function record(value, allowed, required = allowed) {
    ensure(value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(key => allowed.includes(key)) && required.every(key => Object.hasOwn(value, key)));
}
function provider(value) {return typeof value === 'string' && providerPattern.test(value);}
function target(value) {
    record(value, ['providerId', 'name', 'version']);
    ensure(provider(value.providerId) && typeof value.name === 'string' && servicePattern.test(value.name)
        && Number.isSafeInteger(value.version) && value.version >= 1 && value.version <= 9999);
    return value;
}
function capability(value) {target({providerId:value.providerId,name:value.name,version:value.version});return `plugins.shared.call.${value.providerId}.${value.name}.v${value.version}`;}
function isCapability(value) {return typeof value === 'string' && /^plugins\.shared\.call\.[a-zA-Z0-9][a-zA-Z0-9._-]{0,199}\.[a-z][a-z0-9-]{0,63}\.v[1-9][0-9]{0,3}$/.test(value);}
function targetFromCapability(value) {
    if (!isCapability(value)) return null;
    const match = value.match(/^plugins\.shared\.call\.(.+)\.([a-z][a-z0-9-]{0,63})\.v([1-9][0-9]{0,3})$/);
    if (!match) return null;
    return target({providerId:match[1],name:match[2],version:Number(match[3])});
}
function method(value) {return typeof value === 'string' && methodPattern.test(value) && !blocked.has(value);}
function identifier(value) {return typeof value === 'string' && /^[a-zA-Z0-9-]{1,80}$/.test(value);}
function json(value) {
    let nodes = 0, bytes = 0;
    const seen = new Set();
    function visit(item, depth) {
        ensure(depth <= 32 && ++nodes <= 16384);
        if (typeof item === 'string') {bytes += Buffer.byteLength(item);ensure(bytes <= 262144);return;}
        if (item === null || typeof item === 'boolean' || (typeof item === 'number' && Number.isFinite(item))) return;
        ensure(item && typeof item === 'object' && !seen.has(item));
        // Native IPC may create plain objects in a different JavaScript realm.
        ensure(Array.isArray(item) || Object.getPrototypeOf(item) === null || Object.prototype.toString.call(item) === '[object Object]');
        if (Array.isArray(item)) ensure(item.length <= 16384);
        seen.add(item);
        for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(item))) {
            if (Array.isArray(item) && key === 'length') continue;
            bytes += Buffer.byteLength(key);ensure(bytes <= 262144);
            ensure(descriptor.enumerable && Object.hasOwn(descriptor, 'value') && !['constructor','prototype','__proto__'].includes(key));
            visit(descriptor.value, depth + 1);
        }
        seen.delete(item);
    }
    visit(value, 0);
    const encoded = JSON.stringify(value);
    ensure(Buffer.byteLength(encoded) <= 262144);
    return JSON.parse(encoded);
}
module.exports = {error, ensure, record, provider, target, capability, isCapability, targetFromCapability, method, identifier, json};
