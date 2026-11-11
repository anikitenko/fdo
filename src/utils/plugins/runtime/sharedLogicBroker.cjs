const {randomUUID} = require('node:crypto');
const {error, ensure, record, provider, target, capability, method, identifier, json} = require('./sharedLogicContracts.cjs');
const {normalizeContract} = require('./sharedLogicTypeContract.cjs');

// In-memory registrations are bound to a concrete utility-process session.
// Method implementations never execute in the Electron main process.
function createSharedLogicBroker({getWorker, getGrants, resolveTarget = (_consumerId, value) => value, audit = () => {}, unavailable = () => {}, registered = () => {}}) {
    const endpoints = new Set(), services = new Map(), calls = new Map();
    const unavailableNotices = new Map();
    function reportUnavailable(caller, target) {
        const key = JSON.stringify([caller.id, target.providerId, target.name, target.version]);
        if (Date.now() - (unavailableNotices.get(key) || 0) < 30000) return;
        if (unavailableNotices.size >= 256) unavailableNotices.delete(unavailableNotices.keys().next().value);
        unavailableNotices.set(key, Date.now());
        try { unavailable({consumerId:caller.id,providerId:target.providerId,name:target.name,version:target.version}); } catch {}
    }
    const serviceKey = target => JSON.stringify([target.providerId, target.name, target.version]);
    const current = endpoint => !endpoint.closed && getWorker(endpoint.id)?.instance === endpoint.child && getWorker(endpoint.id)?.sessionId === endpoint.sessionId;
    const granted = (endpoint, cap) => {
        try { return current(endpoint) && Array.isArray(getWorker(endpoint.id)?.grantedCapabilities)
            && getWorker(endpoint.id).grantedCapabilities.includes(cap) && getGrants(endpoint.id).includes(cap); }
        catch { return false; }
    };
    const writeAudit = details => {try {audit(details);} catch {}};
    function allowed(caller, service, requestedTarget = service) {
        try {return current(service.owner) && granted(service.owner, 'plugins.shared.provide')
            && granted(caller, 'plugins.shared.use') && granted(caller, capability(service))
            && granted(caller, capability(requestedTarget)) && serviceKey(resolveTarget(caller.id, requestedTarget)) === serviceKey(service);
        } catch {return false;}
    }
    function send(endpoint, message) {try {if (!current(endpoint)) return false;endpoint.child.postMessage(message);return true;} catch {return false;}}
    function settle(call, result, code) {
        if (call.settled) return;
        call.settled = true;clearTimeout(call.timer);
        writeAudit({event: 'shared.call', consumerId: call.caller.id, providerId: call.service.providerId, name: call.service.name, version: call.service.version, method: call.method, code: code || 'OK'});
        if (code === 'UNAVAILABLE') reportUnavailable(call.caller,call.service);
        if (code) call.reject(error(code));else call.resolve(result);
    }
    function cancel(call, code) {
        settle(call, undefined, code);
        // Keep the provider's execution slot until it acknowledges completion.
        // A handler ignoring AbortSignal cannot bypass the concurrency bound.
        send(call.service.owner, {message: 'HOST_SHARED_CANCEL_V1', content: {callId: call.id}});
    }
    function remove(service, code = 'UNAVAILABLE') {
        if (services.get(serviceKey(service)) === service) services.delete(serviceKey(service));
        for (const call of calls.values()) if (call.service === service) cancel(call, code);
    }
    function bind(id, child, sessionId) {
        ensure(provider(id) && typeof sessionId === 'string' && sessionId.length > 0);
        const endpoint = {id, child, sessionId, closed: false};
        endpoints.add(endpoint);
        const onMessage = message => {
            if (message?.type !== 'HOST_SHARED_REPLY_V1' || !current(endpoint)) return;
            const call = calls.get(message.callId);
            if (!call || call.service.owner !== endpoint || message.registrationId !== call.service.registrationId) return;
            calls.delete(call.id);
            if (call.settled) return;
            if (!allowed(call.caller, call.service, call.target) || services.get(serviceKey(call.service)) !== call.service) {settle(call, undefined, 'ACCESS_DENIED');return;}
            try {
                record(message, ['type','callId','registrationId','result','error'], ['type','callId','registrationId']);
                ensure(Object.hasOwn(message, 'error') !== Object.hasOwn(message, 'result'));
                if (Object.hasOwn(message, 'error')) settle(call, undefined, ['CANCELLED','BACKPRESSURE','INVALID_REQUEST'].includes(message.error) ? message.error : 'SERVICE_ERROR');
                else settle(call, json(message.result));
            } catch {settle(call, undefined, 'SERVICE_ERROR');}
        };
        const close = () => {
            if (endpoint.closed) return;
            endpoint.closed = true;endpoints.delete(endpoint);
            child.removeListener('message', onMessage);child.removeListener('exit', close);child.removeListener('error', close);
            for (const service of [...services.values()]) if (service.owner === endpoint) remove(service);
            for (const call of [...calls.values()]) {
                if (call.service.owner === endpoint) {settle(call, undefined, 'UNAVAILABLE');calls.delete(call.id);}
                else if (call.caller === endpoint) cancel(call, 'CANCELLED');
            }
        };
        child.on('message', onMessage);child.once('exit', close);child.once('error', close);
        return {close, async request(value) {
            ensure(current(endpoint), 'UNAVAILABLE');
            ensure(value && typeof value === 'object' && !Array.isArray(value));
            switch (value.op) {
                case 'list':
                    record(value, ['op']);ensure(granted(endpoint, 'plugins.shared.use'), 'ACCESS_DENIED');
                    return catalog();
                case 'register': {
                    record(value, ['op','definition','methods']);ensure(granted(endpoint, 'plugins.shared.provide'), 'ACCESS_DENIED');
                    record(value.definition, ['name','version','description','contract'], ['name','version','description']);
                    const service = {...value.definition, providerId: id};target({providerId:id,name:service.name,version:service.version});
                    ensure(typeof service.description === 'string' && service.description.trim() && service.description.length <= 1000);
                    ensure(Array.isArray(value.methods) && value.methods.length >= 1 && value.methods.length <= 32 && value.methods.every(method) && new Set(value.methods).size === value.methods.length);
                    try { service.contract = normalizeContract(json(value.definition).contract, value.methods); }
                    catch { throw error('INVALID_REQUEST'); }
                    ensure(!services.has(serviceKey(service)), 'CONFLICT');
                    ensure([...services.values()].filter(item => item.owner === endpoint).length < 16, 'BACKPRESSURE');
                    Object.assign(service, {methods:[...value.methods], registrationId:randomUUID(), owner:endpoint});
                    services.set(serviceKey(service), service);
                    try { registered(catalog().find(item => item.providerId === id && item.name === service.name && item.version === service.version)); } catch {}
                    return {registrationId:service.registrationId};
                }
                case 'unregister': {
                    record(value, ['op','registrationId']);ensure(identifier(value.registrationId));
                    const service = [...services.values()].find(item => item.registrationId === value.registrationId && item.owner === endpoint);
                    if (service) remove(service);
                    return null;
                }
                case 'cancel': {
                    record(value, ['op','callId']);ensure(identifier(value.callId));
                    for (const call of calls.values()) if (call.caller === endpoint && call.clientCallId === value.callId) cancel(call, 'CANCELLED');
                    return null;
                }
                case 'call': {
                    record(value, ['op','callId','target','method','input','timeoutMs']);
                    target(value.target);ensure(identifier(value.callId) && method(value.method));
                    ensure(Number.isSafeInteger(value.timeoutMs) && value.timeoutMs > 0 && value.timeoutMs <= 30000);
                    // Authorize before lookup: unapproved consumers cannot probe a private service.
                    ensure(granted(endpoint, 'plugins.shared.use') && granted(endpoint, capability(value.target)), 'ACCESS_DENIED');
                    const resolvedTarget = resolveTarget(endpoint.id, value.target);
                    target(resolvedTarget);
                    ensure(resolvedTarget.name === value.target.name && resolvedTarget.version === value.target.version, 'ACCESS_DENIED');
                    ensure(granted(endpoint, capability(resolvedTarget)), 'ACCESS_DENIED');
                    const service = services.get(serviceKey(resolvedTarget));
                    if (!service || !current(service.owner)) reportUnavailable(endpoint, resolvedTarget);
                    ensure(service && current(service.owner), 'UNAVAILABLE');ensure(allowed(endpoint, service, value.target), 'ACCESS_DENIED');
                    ensure(service.methods.includes(value.method), 'NOT_FOUND');
                    ensure(![...calls.values()].some(call => call.caller === endpoint && call.clientCallId === value.callId), 'CONFLICT');
                    ensure(calls.size < 128 && [...calls.values()].filter(call => call.caller === endpoint && !call.settled).length < 16
                        && [...calls.values()].filter(call => call.service.owner === service.owner).length < 32, 'BACKPRESSURE');
                    const input = json(value.input);
                    return new Promise((resolve,reject) => {
                        const call = {id:randomUUID(),clientCallId:value.callId,caller:endpoint,service,target:{...value.target},method:value.method,resolve,reject,settled:false};
                        call.timer = setTimeout(() => cancel(call, 'TIMEOUT'), value.timeoutMs);
                        calls.set(call.id,call);
                        if (!send(service.owner, {message:'HOST_SHARED_INVOKE_V1',content:{providerId:service.providerId,name:service.name,version:service.version,registrationId:service.registrationId,callId:call.id,method:value.method,input,callerId:id}})) {
                            calls.delete(call.id);settle(call,undefined,'UNAVAILABLE');
                        }
                    });
                }
                default: throw error('INVALID_REQUEST');
            }
        }};
    }
    function catalog() {
        return [...services.values()].filter(service => granted(service.owner,'plugins.shared.provide')).map(service => ({providerId:service.providerId,name:service.name,version:service.version,description:service.description,methods:[...service.methods],capability:capability(service),...(service.contract?{contract:service.contract}:{})}));
    }
    function invalidate(id) {
        for (const service of [...services.values()]) if (service.providerId === id && !granted(service.owner,'plugins.shared.provide')) remove(service,'ACCESS_DENIED');
        for (const call of calls.values()) if ((call.caller.id === id || call.service.providerId === id) && !allowed(call.caller,call.service,call.target)) cancel(call,'ACCESS_DENIED');
    }
    return {bind,catalog,invalidate};
}
module.exports = {createSharedLogicBroker};
