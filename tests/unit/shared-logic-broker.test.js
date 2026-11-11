/** @jest-environment node */
const {EventEmitter} = require('node:events');
const {createSharedLogicBroker} = require('../../src/utils/plugins/runtime/sharedLogicBroker.cjs');
const {capability, isCapability} = require('../../src/utils/plugins/runtime/sharedLogicContracts.cjs');
const {normalizeCapabilityList} = require('../../src/utils/plugins/security/pluginCapabilities');

const target = {providerId:'website-provider',name:'website-availability',version:1};
const cap = capability(target);
const definition = {name:target.name,version:1,description:'Checks website availability'};
let broker, workers, grants, provider, consumer, attacker, audit, connections, next, unavailable, registered, bindings;
function endpoint(id, permissions) {
    const child = Object.assign(new EventEmitter(), {postMessage:jest.fn()});
    workers[id]={instance:child,sessionId:`${id}-session`,grantedCapabilities:[...permissions]};
    grants[id]=[...permissions];
    const connection=broker.bind(id,child,workers[id].sessionId);
    connections.push(connection);
    return {child,...connection};
}
beforeEach(async()=>{
    workers={};grants={};bindings={};connections=[];next=0;audit=jest.fn();
    unavailable=jest.fn();registered=jest.fn();
    broker=createSharedLogicBroker({getWorker:id=>workers[id],getGrants:id=>grants[id]||[],resolveTarget:(id,value)=>({...value,providerId:bindings[id]?.[capability(value)] || value.providerId}),audit,unavailable,registered});
    provider=endpoint(target.providerId,['plugins.shared.provide']);
    consumer=endpoint('consumer',['plugins.shared.use',cap]);
    attacker=endpoint('attacker',['plugins.shared.use']);
    await provider.request({op:'register',definition,methods:['check']});
});
afterEach(()=>{for(const connection of connections)connection.close();jest.useRealTimers();});
const invoke=(connection=consumer,changes={})=>connection.request({op:'call',callId:`client-${++next}`,target,method:'check',input:{url:'https://example.com'},timeoutMs:1000,...changes});
const dispatched=()=>provider.child.postMessage.mock.calls.filter(([message])=>message.message==='HOST_SHARED_INVOKE_V1').at(-1)[0].content;
const reply=(invocation,result={available:true},changes={})=>provider.child.emit('message',{type:'HOST_SHARED_REPLY_V1',callId:invocation.callId,registrationId:invocation.registrationId,result,...changes});

test('stopped providers produce an explicit rate-limited host notice only for approved consumers',async()=>{
    provider.close();
    await expect(invoke(attacker)).rejects.toMatchObject({code:'ACCESS_DENIED'});
    expect(unavailable).not.toHaveBeenCalled();
    await expect(invoke()).rejects.toMatchObject({code:'UNAVAILABLE'});
    await expect(invoke()).rejects.toMatchObject({code:'UNAVAILABLE'});
    expect(unavailable).toHaveBeenCalledTimes(1);
    expect(unavailable).toHaveBeenCalledWith({consumerId:'consumer',...target});
});

test('an in-flight request also notifies FDO when its provider stops',async()=>{
    const pending=invoke();
    const failure=expect(pending).rejects.toMatchObject({code:'UNAVAILABLE'});
    provider.close();await failure;
    expect(unavailable).toHaveBeenCalledWith({consumerId:'consumer',...target});
});

test('publishes validated data-only contracts and rejects arbitrary type code or unknown methods',async()=>{
    const contract={check:{input:{type:'object',properties:{url:{type:'string'}},required:['url']},output:{type:'boolean'}}};
    await provider.request({op:'register',definition:{...definition,name:'typed',contract},methods:['check']});
    expect(broker.catalog().find(item=>item.name==='typed').contract).toEqual(contract);
    expect(registered).toHaveBeenLastCalledWith(expect.objectContaining({name:'typed',contract}));
    for(const invalid of [{check:{input:{type:'eval(process.env)'},output:{type:'boolean'}}},{hidden:contract.check}]) {
        await expect(provider.request({op:'register',definition:{...definition,name:'invalid',contract:invalid},methods:['check']})).rejects.toMatchObject({code:'INVALID_REQUEST'});
    }
});

test('approved consumers reuse only exported logic; caller identity comes from the bound endpoint',async()=>{
    const pending=invoke();const invocation=dispatched();
    expect(invocation.callerId).toBe('consumer');
    expect(invocation.input).toEqual({url:'https://example.com'});
    reply(invocation);
    await expect(pending).resolves.toEqual({available:true});
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({consumerId:'consumer',providerId:target.providerId,method:'check',code:'OK'}));
    expect(JSON.stringify(audit.mock.calls)).not.toContain('https://example.com');
    await expect(invoke(consumer,{method:'privateHandler'})).rejects.toMatchObject({code:'NOT_FOUND'});
});

test('base grants, forged identities, wildcard capabilities and other service versions cannot bypass approval',async()=>{
    await expect(invoke(attacker)).rejects.toMatchObject({code:'ACCESS_DENIED'});
    await expect(invoke(consumer,{callerId:'website-provider'})).rejects.toMatchObject({code:'INVALID_REQUEST'});
    await expect(invoke(consumer,{target:{...target,version:2}})).rejects.toMatchObject({code:'ACCESS_DENIED'});
    await expect(attacker.request({op:'register',definition,methods:['check']})).rejects.toMatchObject({code:'ACCESS_DENIED'});
    expect(normalizeCapabilityList(['plugins.shared.use',cap,'plugins.shared.call.*'])).toEqual(['plugins.shared.use',cap]);
    expect(isCapability(cap)).toBe(true);expect(isCapability('plugins.shared.call.*')).toBe(false);
});

test('provider replies are authenticated to both worker and registration',async()=>{
    const pending=invoke();const invocation=dispatched();
    attacker.child.emit('message',{type:'HOST_SHARED_REPLY_V1',callId:invocation.callId,registrationId:invocation.registrationId,result:'forged'});
    reply(invocation,'forged',{registrationId:'wrong'});
    reply(invocation,'real');
    await expect(pending).resolves.toBe('real');
});

test('revocation is enforced before returning data even if the worker grant snapshot is stale',async()=>{
    const pending=invoke();const failure=expect(pending).rejects.toMatchObject({code:'ACCESS_DENIED'});
    const invocation=dispatched();grants.consumer=['plugins.shared.use'];
    reply(invocation,{private:'must not cross the revoked boundary'});
    await failure;
    await expect(invoke()).rejects.toMatchObject({code:'ACCESS_DENIED'});
});

test('revocation cancels in-flight calls, removes provider exports and prevents stale-session delivery',async()=>{
    const pending=invoke();const failure=expect(pending).rejects.toMatchObject({code:'ACCESS_DENIED'});
    grants[target.providerId]=[];broker.invalidate(target.providerId);
    await failure;expect(broker.catalog()).toEqual([]);
    expect(provider.child.postMessage).toHaveBeenCalledWith(expect.objectContaining({message:'HOST_SHARED_CANCEL_V1'}));
    workers.consumer={...workers.consumer,sessionId:'new'};
    await expect(invoke()).rejects.toMatchObject({code:'UNAVAILABLE'});
});

test('timeouts retain execution slots until provider completion, bounding non-cooperative handlers',async()=>{
    jest.useFakeTimers();
    for(let i=0;i<32;i++){
        const pending=invoke(consumer,{timeoutMs:1});
        const failure=expect(pending).rejects.toMatchObject({code:'TIMEOUT'});
        await jest.advanceTimersByTimeAsync(1);await failure;
    }
    await expect(invoke()).rejects.toMatchObject({code:'BACKPRESSURE'});
    reply(dispatched(),null);
    const fresh=invoke();reply(dispatched());await expect(fresh).resolves.toEqual({available:true});
    expect(jest.getTimerCount()).toBe(0);
});

test('a consumer cannot cancel another plugin’s call; provider exit settles requests and removes metadata',async()=>{
    const pending=invoke(consumer,{callId:'owned'});
    await attacker.request({op:'cancel',callId:'owned'});
    const failure=expect(pending).rejects.toMatchObject({code:'UNAVAILABLE'});
    provider.child.emit('exit',1);
    await failure;expect(broker.catalog()).toEqual([]);
    expect(provider.child.listenerCount('message')).toBe(0);
});

test('registrations are owned by providers and malformed results never escape as implementation errors',async()=>{
    const registration=broker.catalog()[0];
    await expect(provider.request({op:'register',definition,methods:['check']})).rejects.toMatchObject({code:'CONFLICT'});
    const pending=invoke();const failure=expect(pending).rejects.toMatchObject({code:'SERVICE_ERROR'});
    reply(dispatched(),undefined,{error:'private-provider-stack'});await failure;
    await expect(invoke(consumer,{input:'x'.repeat(262145)})).rejects.toMatchObject({code:'INVALID_REQUEST'});
    expect(registration.capability).toBe(cap);
});

 test('explicit per-consumer binding routes logical IDs to installed providers and requires both grants',async()=>{
    const alias={...target,providerId:'logical-example-id'},aliasCap=capability(alias);
    workers.consumer.grantedCapabilities.push(aliasCap);grants.consumer.push(aliasCap);
    await expect(invoke(consumer,{target:alias})).rejects.toMatchObject({code:'UNAVAILABLE'});
    bindings.consumer={[aliasCap]:target.providerId};
    const pending=invoke(consumer,{target:alias});const invocation=dispatched();reply(invocation);
    await expect(pending).resolves.toEqual({available:true});
    grants.consumer=grants.consumer.filter(value=>value!==cap);
    await expect(invoke(consumer,{target:alias})).rejects.toMatchObject({code:'ACCESS_DENIED'});
 });
 test('changing a binding while a call is in flight prevents delivery from the old provider',async()=>{
    const alias={...target,providerId:'logical-example-id'},aliasCap=capability(alias);
    workers.consumer.grantedCapabilities.push(aliasCap);grants.consumer.push(aliasCap);bindings.consumer={[aliasCap]:target.providerId};
    const pending=invoke(consumer,{target:alias});const failure=expect(pending).rejects.toMatchObject({code:'ACCESS_DENIED'});
    const invocation=dispatched();delete bindings.consumer[aliasCap];reply(invocation);await failure;
 });
