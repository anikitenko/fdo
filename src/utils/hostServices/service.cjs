const {randomUUID} = require('node:crypto');
const {ensure,failure, request, required, profile: validateProfile, key, text} = require('./contracts.cjs');
const {parse: parseGit, select: selectGit, isURL} = require('./gitPolicy.cjs');
const {executeSSH} = require('./ssh.cjs');
const {createTerminalService}=require('./terminalService.cjs');
const {createLocalDisplays}=require('./localDisplay.cjs');
const {createLiveSSH} = require('./liveSSH.cjs');

function createHostService({vault, Client, getGrants, isInstalled, audit = () => {}, executeGit, displays=createLocalDisplays()}) {
    const views=new Map();
    const terminals=createTerminalService({Client,displays,audit,getViewLease(pluginId){const now=Date.now();const lease=[...views.values()].find(view=>view.pluginId===pluginId&&view.expires>now);return lease?{valid:()=>views.get(lease.id)===lease&&lease.expires>Date.now()}:null;},authorize(pluginId,profileId,mode,consume,revision){
        grants(pluginId,'ssh.terminal.open');
        const profile=vault.profile(pluginId,profileId);
        if(!profile||!profile.policy.consumers.includes('ssh.terminal.open')||revision&&JSON.stringify(profile)!==revision)throw failure('ACCESS_DENIED');
        validateProfile(profile);
        if(mode&&(!getGrants(pluginId).includes('ssh.x11.forward')||!profile.policy.x11Modes?.includes(mode)))throw failure('ACCESS_DENIED');
        return {profile,credentials:consume?credentialsFor(pluginId,profile.authentication):undefined};
    }});
    const endpoints = new Set(), activeGit = new Set();
    const cancel = pluginId => {for (const operation of activeGit) if (operation.pluginId === pluginId) operation.controller.abort(); for (const endpoint of endpoints) if (endpoint.pluginId === pluginId) endpoint.cancel();};
    const grants = (pluginId, action) => {
        if (!isInstalled(pluginId) || !required(action).every(capability => getGrants(pluginId).includes(capability))) throw failure('ACCESS_DENIED');
    };
    const credentialsFor = (pluginId, auth) => {
        const credentials = {};
        for (const [field, ref] of [['password', auth.passwordRef], ['privateKey', auth.privateKeyRef], ['passphrase', auth.passphraseRef]]) {
            if (!ref) continue;
            const value = vault.get(pluginId, ref.key);
            if (value === null) throw failure('UNAVAILABLE');
            credentials[field] = value;
        }
        return credentials;
    };
    const liveSSH = createLiveSSH({Client,audit,authorize(pluginId,profileId,action,command,consume=true) {
        grants(pluginId,action);
        const profile=vault.profile(pluginId,profileId);
        if(!profile||!profile.policy.consumers.includes('ssh.exec') || action==='ssh.exec' && profile.policy.allowAllCommands!==true && !profile.policy.commands.includes(command))throw failure('ACCESS_DENIED');
        validateProfile(profile);
        return {profile,credentials:consume?credentialsFor(pluginId,profile.authentication):undefined};
    }});
    return {
        cancel,
        readiness:()=>terminals.readiness(),
        checkX11:()=>terminals.checkX11(),
        viewLease(owner,pluginId,id,active){text(pluginId,256);key(id);if(!isInstalled(pluginId))throw failure('ACCESS_DENIED');const name=JSON.stringify([owner,id]);const old=views.get(name);if(old&&old.pluginId!==pluginId)throw failure('ACCESS_DENIED');if(active){if(!old&&views.size>=128)throw failure('SESSION_LIMIT');if(old)old.expires=Date.now()+30000;else views.set(name,{id:name,pluginId,expires:Date.now()+30000});}else views.delete(name);terminals.invalidateViews();},
        releaseViews(owner){for(const id of views.keys())if(JSON.parse(id)[0]===owner)views.delete(id);terminals.invalidateViews();},
        async runGit(pluginId, plan, requestId = randomUUID()) {
            if (!isInstalled(pluginId)) throw failure('ACCESS_DENIED');
            const mode = vault.gitMode(pluginId);
            if (mode === false) return null; // Deliberate host-owned legacy opt-out.
            if (mode === null) {
                // An SSH-capable plugin must enroll its own Git profile first.
                // Never silently launch machine SSH when profile setup is missing.
                if (getGrants(pluginId).includes('ssh.use')) throw failure('ACCESS_DENIED');
                return null;
            }
            const profiles = vault.profiles(pluginId);
            if (!profiles.some(profile => profile.policy.consumers.includes('git'))) throw failure('ACCESS_DENIED');
            const invocation = parseGit(plan), {operation,remote,policyOperation} = invocation;
            const expected = ['system.process.exec', 'system.process.scope.git', 'ssh.use', 'ssh.exec', 'secrets.use', 'secrets.consume'];
            const authorize = () => {if (!isInstalled(pluginId) || !expected.every(capability => getGrants(pluginId).includes(capability))) throw failure('ACCESS_DENIED');};
            const authorizeTarget = (url, requestedOperation) => {
                authorize();
                const selection=selectGit(vault.profiles(pluginId),url,requestedOperation);
                validateProfile(selection.profile);
                return {...selection,credentials:credentialsFor(pluginId,selection.profile.authentication)};
            };
            const selected=remote&&isURL(remote)?authorizeTarget(remote,policyOperation):null;
            authorize();
            if (!executeGit || [...activeGit].filter(item => item.pluginId === pluginId).length >= 4) throw failure('UNAVAILABLE');
            const controller = new AbortController();
            let complete; const done = new Promise(resolve => {complete = resolve;});
            const entry = {pluginId, controller, done}; activeGit.add(entry);
            let outcome = 'UNAVAILABLE';
            try {
                audit(pluginId, 'git.' + operation, 'STARTED', requestId);
                const result = await executeGit({plan,invocation,selection:selected,operation,credentials:selected?.credentials,authorizeTarget,signal:controller.signal});
                authorize(); ensure(!controller.signal.aborted,'ACCESS_DENIED');
                outcome = result.exitCode === 0 ? 'OK' : 'CONNECTION_FAILED'; return result;
            } catch (error) {outcome = failure(error?.code).code; throw Object.assign(failure(outcome), {gitFailure: error?.gitFailure});}
            finally {activeGit.delete(entry); complete(); audit(pluginId, 'git.' + operation, outcome, requestId);}
        },
        setGitEnabled(pluginId, enabled) {if (!isInstalled(pluginId)) throw failure('ACCESS_DENIED'); if (typeof enabled !== 'boolean') throw failure('INVALID_REQUEST'); cancel(pluginId); vault.setGitEnabled(pluginId, enabled);},
        uninstall(pluginId) {cancel(pluginId); vault.uninstall(pluginId);},
        saveSecret(pluginId, name, value) {if (!isInstalled(pluginId)) throw failure('ACCESS_DENIED'); cancel(pluginId); return vault.set(pluginId, name, value);},
        deleteSecret(pluginId, name) {if (!isInstalled(pluginId)) throw failure('ACCESS_DENIED'); cancel(pluginId); return vault.delete(pluginId, name);},
        saveProfile(pluginId, input) {
            if (!isInstalled(pluginId)) throw failure('ACCESS_DENIED');
            const value = validateProfile(input);
            credentialsFor(pluginId, value.authentication); // Validate every referenced name in this owner namespace.
            cancel(pluginId); vault.putProfile(pluginId, value);
        },
        deleteProfile(pluginId, id) {if (!isInstalled(pluginId)) throw failure('ACCESS_DENIED'); cancel(pluginId); vault.deleteProfile(pluginId, key(id));},
        bind(pluginId) {
            text(pluginId, 256);
            let closed = false, livePending = 0;
            const live = liveSSH.bind(pluginId),terminal=terminals.bind(pluginId);
            const active = new Map(), used = new Set();
            const endpoint = {pluginId, cancel() {terminal.cancel();live.cancel();for (const controller of active.values()) controller.abort();}, close() {closed = true; this.cancel();terminal.close();live.close();}};
            endpoints.add(endpoint);
            return {
                close() {endpoint.close(); endpoints.delete(endpoint);},
                async operation(operation,payload,requestId=randomUUID()) {
                    if(closed)throw failure('UNAVAILABLE');
                    if(typeof requestId!=='string'||!/^[a-zA-Z0-9-]{1,80}$/.test(requestId)||used.has(requestId)||used.size>=100000||active.size+livePending>=(['terminal.close','terminal.cancel','terminal.eof'].includes(operation)?32:24))throw failure('INVALID_REQUEST');
                    used.add(requestId);livePending++;let result;
                    try {
                        result=await (operation.startsWith('terminal.')?terminal:live).operation(operation,payload,requestId);
                        if(['watch','cancel','return'].includes(operation))audit(pluginId,'ssh.'+operation,'OK',requestId);
                        return result;
                    } catch(error) {
                        if(operation==='watch'&&result?.handle)try{await live.operation('return',{handle:result.handle},requestId);}catch{live.cancel();}
                        const safe=failure(error?.code);try{audit(pluginId,'ssh.service',safe.code,requestId);}catch{}throw safe;
                    } finally {livePending--;}
                },
                async request(value, requestId = randomUUID()) {
                    let action = 'invalid', outcome = 'UNAVAILABLE';
                    ensure(!closed, 'UNAVAILABLE');
                    if (typeof requestId !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(requestId) || active.size + livePending >= 24 || used.has(requestId) || used.size >= 100000) throw failure('INVALID_REQUEST');
                    used.add(requestId);
                    const controller = new AbortController(); active.set(requestId, controller);
                    let requestResult, requestFailure;
                    try {
                        const {action: name, payload} = request(value); action = name;
                        audit(pluginId, action, 'STARTED', requestId);
                        grants(pluginId, action);
                        let result;
                        if (action === 'secrets.set') {cancel(pluginId); result = vault.set(pluginId, payload.key, payload.value);}
                        else if (action === 'secrets.get') result = {value: vault.get(pluginId, payload.key)};
                        else if (action === 'secrets.delete') {cancel(pluginId); result = vault.delete(pluginId, payload.key);}
                        else if (action === 'secrets.list') result = {entries: vault.list(pluginId)};
                        else if (action === 'ssh.profiles.list') result = {profiles: vault.summaries(pluginId, ['ssh.exec','ssh.terminal.open'])};
                        else {
                            // Snapshot the entire profile, trust and policy in one read. No credential cache.
                            const selected = vault.profile(pluginId, payload.profileId);
                            ensure(selected && selected.policy.consumers.includes('ssh.exec') && (selected.policy.allowAllCommands === true || selected.policy.commands.includes(payload.command)), 'ACCESS_DENIED');
                            validateProfile(selected);
                            result = await executeSSH({Client, profile: selected, credentials: credentialsFor(pluginId, selected.authentication), ...payload, timeoutMs:Math.min(payload.timeoutMs,120000),maxOutputBytes:Math.min(payload.maxOutputBytes,4194304), signal: controller.signal});
                        }
                        // Mutations cancel other active SSH work; this synchronous request still completes.
                        ensure(!closed, 'UNAVAILABLE');
                        grants(pluginId, action);
                        ensure(action !== 'ssh.exec' || !controller.signal.aborted, 'ACCESS_DENIED');
                        outcome = 'OK'; requestResult = result;
                    } catch (error) {outcome = failure(error?.code).code; requestFailure = failure(outcome);}
                    finally {active.delete(requestId);}
                    try {audit(pluginId, action, outcome, requestId);} catch {throw failure('UNAVAILABLE');}
                    if (requestFailure) throw requestFailure;
                    return requestResult;
                },
            };
        },
        async close() {
            for (const endpoint of endpoints) endpoint.close();
            endpoints.clear();
            const operations = [...activeGit]; for (const entry of operations) entry.controller.abort();
            await Promise.allSettled(operations.map(entry => entry.done));
            await liveSSH.close();
            views.clear();await terminals.close();
            // Aborted SSH promises finish their safe audit records before SQLite closes.
            await Promise.resolve();
            vault.close();
        },
    };
}
module.exports = {createHostService};
