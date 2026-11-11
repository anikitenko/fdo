// Serialized into each exported project. All cross-plugin traffic stays on
// authenticated parent/child IPC; no shared-service HTTP endpoint is exposed.
export function sharedWebRuntime({configuration, root, registry, run, getView}) {
    const path = require('node:path'), {EventEmitter} = require('node:events');
    const {randomUUID, createHash} = require('node:crypto'), {fork} = require('node:child_process');
    const {AsyncLocalStorage} = require('node:async_hooks');
    const {capability, target, error} = require(path.join(__dirname,'sharedLogicContracts.cjs'));
    const remote = configuration.sharedLogic?.provider === true;
    const pending = new Map(), children = new Map(), workers = new Map(), confirmations = new Map();
    const context = new AsyncLocalStorage();
    let closed = false, endpoint, broker;
    const send = (child, message) => {
        if (!child.connected) throw error('UNAVAILABLE');
        child.send(message, failure => {
            if (!failure) return;
            if (child===process) {for(const id of pending.keys())finish(pending,id,undefined,'UNAVAILABLE');}
            else child.emit('error',failure);
        });
    };
    const finish = (map, id, value, failure) => {
        const item = map.get(id);if (!item) return;
        map.delete(id);clearTimeout(item.timer);
        if (failure) item.reject(error(failure));else item.resolve(value);
    };
    const dispatch = (message, viewId, reply) => {
        if (message.message === 'HOST_SHARED_CANCEL_V1') {registry.cancelSharedLogicInvocation(message.content.callId);return;}
        if (message.message !== 'HOST_SHARED_INVOKE_V1') return;
        void run(() => registry.dispatchSharedLogic(message.content),viewId).then(
            result => reply({type:'HOST_SHARED_REPLY_V1',callId:message.content.callId,registrationId:message.content.registrationId,...result}),
            () => reply({type:'HOST_SHARED_REPLY_V1',callId:message.content.callId,registrationId:message.content.registrationId,error:'SERVICE_ERROR'}));
    };
    const resolveTarget = (id,value) => {
        const manifest = workers.get(id)?.configuration;
        const binding = manifest?.sharedLogic?.bindings?.find(item => item.providerId === value.providerId && item.name === value.name && item.version === value.version);
        return binding ? {...value,providerId:binding.installedProviderId} : value;
    };
    const request = async (id, bound, value) => {
        if (closed) throw error('UNAVAILABLE');
        if (value?.op !== 'requestAccess') return bound.request(value);
        target(value.target);
        const grants = workers.get(id)?.grantedCapabilities || [], resolved = resolveTarget(id,value.target);
        if (!grants.includes('plugins.shared.use') || !grants.includes(capability(value.target)) || !grants.includes(capability(resolved))
            || !workers.get(resolved.providerId)?.grantedCapabilities.includes('plugins.shared.provide')) throw error('ACCESS_DENIED');
        return {state:'approved',capability:capability(value.target)};
    };
    if (!remote) {
        broker = require(path.join(__dirname,'sharedLogicBroker.cjs')).createSharedLogicBroker({
            getWorker:id=>workers.get(id),getGrants:id=>workers.get(id)?.grantedCapabilities || [],resolveTarget,
            unavailable:info=>console.warn('[shared-service] Provider unavailable:',info.providerId,info.name,'v'+info.version),
        });
        const local = new EventEmitter(), sessionId = randomUUID();
        local.postMessage = message => {const viewId=context.getStore() || getView();queueMicrotask(()=>dispatch(message,viewId,reply=>local.emit('message',reply)));};
        workers.set(configuration.pluginId,{instance:local,sessionId,configuration,grantedCapabilities:configuration.capabilities});
        endpoint = broker.bind(configuration.pluginId,local,sessionId);
        registry.configureSharedLogic({request:value=>context.run(getView(),()=>request(configuration.pluginId,endpoint,value))});
    } else {
        registry.configureSharedLogic({request:value=>new Promise((resolve,reject)=>{
            if (closed || !process.connected) return reject(error('UNAVAILABLE'));
            if (pending.size >= 128) return reject(error('BACKPRESSURE'));
            const id=randomUUID(),timer=setTimeout(()=>finish(pending,id,undefined,'TIMEOUT'),35000);
            pending.set(id,{resolve,reject,timer});
            try {send(process,{sharedRequest:true,id,request:value,viewId:getView()});}
            catch {finish(pending,id,undefined,'UNAVAILABLE');}
        })});
    }
    // The plugin cannot replace its authenticated deployment transport.
    registry.configureSharedLogic=()=>{throw error('ACCESS_DENIED');};
    const onMessage = message => {
        if (remote && message?.sharedReply) finish(pending,message.id,message.result,message.error);
        if (remote && message?.message?.startsWith('HOST_SHARED_')) dispatch(message,message.sharedViewId,reply=>{try{send(process,reply);}catch{}});
        if (!remote && message?.confirmationReply) {
            const item=confirmations.get(message.id),child=item?.child;confirmations.delete(message.id);clearTimeout(item?.timer);
            if (child?.connected) send(child,message);
        }
    };
    process.on('message',onMessage);
    const rpc = (state,operation) => new Promise((resolve,reject)=>{
        const id=randomUUID(),timer=setTimeout(()=>finish(state.pending,id,undefined,'TIMEOUT'),15000);
        state.pending.set(id,{resolve,reject,timer});
        try {send(state.child,{id,operation});}catch{finish(state.pending,id,undefined,'UNAVAILABLE');}
    });
    const startProvider = provider => new Promise((resolve,reject)=>{
        const directory=path.resolve(__dirname,'..',provider.directory);
        const manifest=require(path.join(directory,'deployment/application.json'));
        if (manifest.pluginId !== provider.id || !manifest.sharedLogic?.provider) return reject(error('INVALID_REQUEST'));
        const dataRoot=path.join(root,'shared-providers',createHash('sha256').update(provider.id).digest('hex').slice(0,24));
        const child=fork(path.join(directory,'worker.cjs'),[],{env:{...process.env,WEB_APP_DATA_DIR:dataRoot,HOME:dataRoot,AZURE_CONFIG_DIR:path.join(dataRoot,'azure')},stdio:['ignore','inherit','inherit','ipc']});
        const adapter=new EventEmitter(),sessionId=randomUUID();
        adapter.postMessage=message=>send(child,{...message,sharedViewId:context.getStore()});
        workers.set(provider.id,{instance:adapter,sessionId,configuration:manifest,grantedCapabilities:manifest.capabilities});
        const bound=broker.bind(provider.id,adapter,sessionId), state={child,bound,pending:new Map(),adapter};
        children.set(provider.id,state);
        const timer=setTimeout(()=>{reject(error('TIMEOUT'));child.kill('SIGKILL');},15000);
        const stopped=()=>{
            clearTimeout(timer);bound.close();workers.delete(provider.id);reject(error('UNAVAILABLE'));
            for (const id of state.pending.keys()) finish(state.pending,id,undefined,'UNAVAILABLE');
            for (const [id,item] of confirmations) if (item.child===child) {clearTimeout(item.timer);confirmations.delete(id);}
        };
        child.once('exit',stopped);child.on('error',stopped);
        child.on('message',message=>{
            if (message?.ready) {void rpc(state,'initialize').then(()=>{clearTimeout(timer);resolve();},failure=>{clearTimeout(timer);reject(failure);});return;}
            if (message?.sharedRequest) {
                void context.run(message.viewId,()=>request(provider.id,bound,message.request)).then(
                    result=>{if(child.connected)send(child,{sharedReply:true,id:message.id,result});},
                    failure=>{if(child.connected)send(child,{sharedReply:true,id:message.id,error:failure.code || 'SERVICE_ERROR'});}).catch(()=>{});return;
            }
            if (message?.type==='HOST_SHARED_REPLY_V1') {adapter.emit('message',message);return;}
            if (message?.confirmation) {
                if (confirmations.size>=128) {send(child,{confirmationReply:true,id:message.confirmation.id,approved:false});return;}
                const id=message.confirmation.id;
                clearTimeout(confirmations.get(id)?.timer);
                const timer=setTimeout(()=>confirmations.delete(id),90000);timer.unref();
                confirmations.set(id,{child,timer});
                process.send?.(message);return;
            }
            finish(state.pending,message?.id,message?.result,message?.error ? message.code || 'SERVICE_ERROR' : undefined);
        });
    });
    const close = async () => {
        if (closed) return;closed=true;
        process.removeListener('message',onMessage);
        for (const id of pending.keys()) finish(pending,id,undefined,'UNAVAILABLE');
        endpoint?.close();
        for (const state of [...children.values()].reverse()) {
            const kill=setTimeout(()=>state.child.kill('SIGKILL'),2000);kill.unref();
            try {if(state.child.connected)await rpc(state,'shutdown');}catch{}finally{
                state.bound.close();if(state.child.connected)state.child.disconnect();state.child.kill();
                for(const id of state.pending.keys())finish(state.pending,id,undefined,'UNAVAILABLE');
                state.child.once('exit',()=>clearTimeout(kill));if(state.child.exitCode!==null)clearTimeout(kill);
            }
        }
        children.clear();for(const item of confirmations.values())clearTimeout(item.timer);confirmations.clear();workers.clear();
    };
    return {async start() {
        if (remote) return;
        try {for (const provider of configuration.sharedLogic?.providers || []) await startProvider(provider);}
        catch (failure) {await close();throw failure;}
    },verify() {
        if (remote) return;
        const catalog=broker.catalog();
        for (const worker of workers.values()) for (const binding of worker.configuration.sharedLogic?.bindings || []) {
            if (!catalog.some(service=>service.providerId===binding.installedProviderId && service.name===binding.name && service.version===binding.version)) {
                console.error('[shared-service] Required provider did not register:',binding.installedProviderId,binding.name,'v'+binding.version);
                throw error('UNAVAILABLE');
            }
        }
    },close};
}
