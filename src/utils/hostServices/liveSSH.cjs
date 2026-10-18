const {randomUUID} = require('node:crypto');
const {failure,record,key,request} = require('./contracts.cjs');
const {executeSSH,observeSSH} = require('./ssh.cjs');
const {createQueue} = require('./asyncQueue.cjs');

function createLiveSSH({Client, authorize, audit = () => {}, pollMs = 5000, handshakeMs = 10000}) {
    const monitors = new Map(), executions = new Set();
    const staleAfterMs = Math.max(1000, pollMs + handshakeMs + 5000);
    function subscribe(pluginId, profileId) {
        const monitorId = JSON.stringify([pluginId,profileId]);
        let monitor = monitors.get(monitorId);
        if (!monitor) {
            if(monitors.size>=32 || [...monitors.values()].filter(item=>item.pluginId===pluginId).length>=8)throw failure('UNAVAILABLE');
            monitor = {pluginId,queues:new Set(),controller:new AbortController(),timer:null,status:{profileId,state:'unknown',checkedAt:null,staleAfterMs}};
            monitors.set(monitorId,monitor);
            const publish = state => {
                monitor.status={profileId,state,checkedAt:new Date().toISOString(),staleAfterMs};
                for(const queue of monitor.queues)queue.push(monitor.status);
            };
            const probe = async () => {
                if(monitor.controller.signal.aborted)return;
                try {
                    const {profile,credentials}=authorize(pluginId,profileId,'ssh.status.watch');
                    if(monitor.status.state!=='connected')publish('connecting');
                    await observeSSH({Client,profile,credentials,signal:monitor.controller.signal,handshakeMs});
                    authorize(pluginId,profileId,'ssh.status.watch',undefined,false);
                    if(!monitor.controller.signal.aborted)publish('connected');
                } catch(error) {
                    if(monitor.controller.signal.aborted)return;
                    if(error.code==='ACCESS_DENIED') {for(const queue of monitor.queues)queue.end(failure('ACCESS_DENIED'));monitor.stop();return;}
                    publish('disconnected');
                }
                if(!monitor.controller.signal.aborted)monitor.timer=setTimeout(probe,pollMs);
            };
            monitor.stop=() => {clearTimeout(monitor.timer);monitor.controller.abort();monitors.delete(monitorId);};
            // Install the first subscription and return its initial unknown observation
            // before any network work begins.
            monitor.timer=setTimeout(probe,0);
        }
        const queue=createQueue({limit:2,latest:true});monitor.queues.add(queue);queue.push(monitor.status);
        return {queue,release(error) {
            queue.end(error);void queue.return();monitor.queues.delete(queue);
            if(!monitor.queues.size)monitor.stop();
        }};
    }
    return {
        async close() {
            for(const monitor of monitors.values()) {
                for(const queue of monitor.queues)queue.end(failure('UNAVAILABLE'));
                monitor.stop();
            }
            const active=[...executions];
            for(const entry of active)entry.controller.abort(failure('UNAVAILABLE'));
            await Promise.allSettled(active.map(entry=>entry.result));
        },
        bind(pluginId) {
            const handles=new Map();let closed=false;
            const check = handle => {
                if(closed)throw failure('UNAVAILABLE');
                const entry=handles.get(handle);if(!entry)throw failure('ACCESS_DENIED');
                authorize(pluginId,entry.profileId,entry.kind==='watch'?'ssh.status.watch':'ssh.exec',entry.command,false);
                return entry;
            };
            const discard = (id,entry) => {clearTimeout(entry.expiry);handles.delete(id);};
            const stop = (entry,code) => {
                if(entry.kind==='watch')entry.subscription.release(failure(code));
                else if(!entry.finished)entry.controller.abort(failure(code));
            };
            return {
                cancel(code='ACCESS_DENIED') {for(const entry of handles.values())stop(entry,code);},
                close() {closed=true;for(const [id,entry]of handles){stop(entry,'UNAVAILABLE');entry.queue?.end(failure('UNAVAILABLE'));discard(id,entry);}},
                async operation(operation,payload,requestId) {
                    if(closed)throw failure('UNAVAILABLE');
                    if(operation==='watch'||operation==='start') {
                        if(handles.size>=64)throw failure('UNAVAILABLE');
                        const id=randomUUID();let entry;
                        if(operation==='watch') {
                            record(payload,['profileId']);key(payload.profileId);
                            authorize(pluginId,payload.profileId,'ssh.status.watch',undefined,false);
                            entry={kind:'watch',profileId:payload.profileId,subscription:subscribe(pluginId,payload.profileId)};
                            entry.queue=entry.subscription.queue;
                        } else {
                            request({action:'ssh.exec',payload});
                            if(executions.size>=32||[...executions].filter(item=>item.pluginId===pluginId).length>=4)throw failure('UNAVAILABLE');
                            const {profile,credentials}=authorize(pluginId,payload.profileId,'ssh.exec',payload.command);
                            try {audit(pluginId,'ssh.exec','STARTED',requestId);}
                            catch {credentials.password=credentials.privateKey=credentials.passphrase=undefined;throw failure('UNAVAILABLE');}
                            entry={kind:'execution',pluginId,profileId:payload.profileId,command:payload.command,queue:createQueue(),controller:new AbortController(),finished:false};
                            executions.add(entry);
                            const result=executeSSH({Client,profile,credentials,...payload,
                                timeoutMs:Math.min(payload.timeoutMs,120000),maxOutputBytes:Math.min(payload.maxOutputBytes,4194304),
                                handshakeMs,signal:entry.controller.signal,onOutput:event=>entry.outputClosed || entry.queue.push(event)});
                            entry.result=result.then(value=>{check(id);audit(pluginId,'ssh.exec','OK',requestId);return value;}).then(value=>{
                                entry.queue.end();return value;
                            },error=>{const safe=failure(error?.code);try{audit(pluginId,'ssh.exec',safe.code,requestId);}catch{}entry.queue.end(safe);throw safe;}).finally(()=>{
                                entry.finished=true;executions.delete(entry);
                                if(!closed)entry.expiry=setTimeout(()=>{entry.queue.end(failure('UNAVAILABLE'));discard(id,entry);},120000);
                                entry.expiry?.unref?.();
                            });
                            // A caller may consume output before asking for the result.
                            entry.result.catch(()=>{});
                        }
                        handles.set(id,entry);return {handle:id};
                    }
                    record(payload,['handle']);key(payload.handle);
                    const entry=check(payload.handle);
                    if(operation==='next') {
                        const result=await entry.queue.next();
                        if(!result.done)check(payload.handle);
                        return result;
                    }
                    if(operation==='return') {
                        if(entry.kind==='watch'){entry.subscription.release();discard(payload.handle,entry);return {done:true};}
                        entry.outputClosed=true;return entry.queue.return(); // Stops output only, never the command.
                    }
                    if(entry.kind!=='execution')throw failure('INVALID_REQUEST');
                    if(operation==='result') {const result=await entry.result;check(payload.handle);return result;}
                    if(operation==='cancel') {
                        if(!entry.cancelled){entry.cancelled=true;if(!entry.finished)entry.controller.abort(failure('CANCELLED'));}
                        return {remoteProcessStopped:null}; // Channel closure cannot prove termination.
                    }
                    throw failure('INVALID_REQUEST');
                },
            };
        },
    };
}
module.exports={createLiveSSH};
