// Standalone backend services. Trusted transports are captured before plugin network guards.
export function createWebServices({configuration,root,view}) {
    const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{spawn}=require('node:child_process');
    const core=require(path.join(__dirname,'service-core.cjs')),fetch=globalThis.fetch.bind(globalThis);
    const grants=configuration.capabilities,pluginId=configuration.pluginId;
    const settings=JSON.parse(fs.readFileSync(path.join(__dirname,'../deployment/services.json'),'utf8'));
    const fail=(code,message)=>Object.assign(new Error(message || code),{code});
    const requireGrant=id=>{if(!grants.includes(id))throw fail('ACCESS_DENIED','Operation is not approved: '+id);};
    const key=()=>{const value=Buffer.from(process.env.WEB_APP_SECRET_KEY || '','base64');if(value.length!==32)throw fail('LOCKED','Set WEB_APP_SECRET_KEY to a base64-encoded 32-byte encryption key.');return value;};
    const vaultFile=path.join(root,'services.enc');
    const load=()=>{
        const secret=key();
        if(!fs.existsSync(vaultFile))return {secrets:{},profiles:{},gitMode:null};
        try{const data=fs.readFileSync(vaultFile),cipher=crypto.createDecipheriv('aes-256-gcm',secret,data.subarray(0,12));cipher.setAuthTag(data.subarray(12,28));return JSON.parse(Buffer.concat([cipher.update(data.subarray(28)),cipher.final()]).toString('utf8'));}
        catch{throw fail('LOCKED','The service vault could not be decrypted. Restore its encryption key.');}
    };
    const save=value=>{
        const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',key(),iv),data=Buffer.concat([cipher.update(JSON.stringify(value),'utf8'),cipher.final()]);
        const temporary=vaultFile+'.'+crypto.randomUUID()+'.tmp';
        try{fs.writeFileSync(temporary,Buffer.concat([iv,cipher.getAuthTag(),data]),{flag:'wx',mode:0o600});fs.renameSync(temporary,vaultFile);}
        finally{fs.rmSync(temporary,{force:true});}
    };
    const identifier=name=>{if(typeof name!=='string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(name))throw fail('INVALID_REQUEST');};
    const vault={
        set(_id,name,value){identifier(name);if(typeof value!=='string' || Buffer.byteLength(value)>1048576)throw fail('INVALID_REQUEST');const data=load();data.secrets[name]={value,updatedAt:new Date().toISOString()};if(Object.keys(data.secrets).length>256 || Buffer.byteLength(JSON.stringify(data.secrets))>8388608)throw fail('INVALID_REQUEST');save(data);return {stored:true};},
        get(_id,name){identifier(name);return Object.hasOwn(load().secrets,name)?load().secrets[name].value:null;},
        list(){return Object.entries(load().secrets).map(([key,{updatedAt}])=>({key,updatedAt}));},
        delete(_id,name){identifier(name);const data=load(),deleted=Object.hasOwn(data.secrets,name);delete data.secrets[name];save(data);return {deleted};},
        profiles(){return Object.values(load().profiles);},
        profile(_id,name){identifier(name);const profiles=load().profiles;return Object.hasOwn(profiles,name)?profiles[name]:null;},
        summaries(_id,consumers){return this.profiles().filter(profile=>consumers.some(consumer=>profile.policy.consumers.includes(consumer))).map(({id,label,host,port,username,authentication,trustedHostKey})=>({id,label,host,port,username,authenticationType:authentication.type,trustedHostKey}));},
        putProfile(_id,profile){identifier(profile.id);core.validateSSHProfile(profile);const data=load();data.profiles[profile.id]=profile;if(Object.keys(data.profiles).length>64)throw fail('INVALID_REQUEST');if(profile.policy.consumers.includes('git'))data.gitMode=true;save(data);},
        gitMode(){return load().gitMode;},
        audit(_id,action,outcome,requestId){console.info('[host-service]',JSON.stringify({action,outcome,requestId}));},
        close(){},
    };
    for(const profile of settings.sshProfiles || []){core.validateSSHProfile(profile);vault.putProfile(pluginId,profile);}
    for(const [name,env] of Object.entries(settings.secretEnvironment || {}))if(process.env[env]!==undefined)vault.set(pluginId,name,process.env[env]);
    const Client=require('ssh2').Client;
    const host=core.createHostService({vault,Client,getGrants:()=>grants,isInstalled:id=>id===pluginId,
        audit:(id,action,outcome,requestId)=>vault.audit(id,action,outcome,requestId),
        executeGit:options=>core.runGitTransport({...options,Client,helperPath:path.join(__dirname,'git-ssh-helper.cjs')}),
    });
    const endpoint=host.bind(pluginId);
    const mappings=Object.entries(settings.pathMappings || {}).sort((a,b)=>b[0].length-a[0].length);
    const mapPath=value=>{if(typeof value!=='string')return value;const normalized=path.resolve(value);for(const [from,to] of mappings){if(normalized===from || normalized.startsWith(from+path.sep))return path.join(to==='/data'?root:to.startsWith('/data/')?path.join(root,to.slice(6)):to,path.relative(from,normalized));}return value;};
    const processScopes=(configuration.processScopes || []).map(scope=>({...scope,allowedCwdRoots:scope.allowedCwdRoots.map(mapPath)}));
    const filesystemScopes=(configuration.filesystemScopes || []).map(scope=>({...scope,allowedRoots:scope.allowedRoots.map(mapPath)}));
    for(const directory of new Set([...processScopes.flatMap(scope=>scope.allowedCwdRoots),...filesystemScopes.flatMap(scope=>scope.allowedRoots)]))if(directory.startsWith(root+path.sep))fs.mkdirSync(directory,{recursive:true,mode:0o700});
    core.setHostPluginCustomProcessScopes(pluginId,processScopes);
    core.setHostPluginCustomFilesystemScopes(pluginId,filesystemScopes);
    const confirmations=new Map();
    process.on('message',message=>{if(!message?.confirmationReply)return;const item=confirmations.get(message.id);if(item){clearTimeout(item.timer);confirmations.delete(message.id);item.resolve(message.approved===true);}});
    const confirm=detail=>new Promise(resolve=>{
        const viewId=view.getStore();
        if(!viewId || confirmations.size>=16)return resolve(false);
        const id=crypto.randomUUID(),timer=setTimeout(()=>{confirmations.delete(id);resolve(false);},90000);
        confirmations.set(id,{resolve,timer});process.send?.({confirmation:{id,viewId,detail}});
    });
    const activeProcesses=new Set();
    const processRun=plan=>new Promise((resolve,reject)=>{
        // Validation has already checked the original executable, args, cwd and env.
        const command=settings.executables?.[plan.command] || plan.command;
        const env={PATH:process.env.PATH,HOME:root,LANG:'C.UTF-8',AZURE_CONFIG_DIR:path.join(root,'azure')};
        for(const name of plan.allowedEnvKeys || [])if(process.env[name]!==undefined)env[name]=process.env[name];
        Object.assign(env,plan.env || {});
        const child=spawn(command,plan.args,{cwd:plan.cwd || root,env,shell:false,detached:process.platform!=='win32',stdio:['ignore','pipe','pipe']});
        let stdout=[],stderr=[],bytes=0,timedOut=false,truncated=false,kill;
        const signal=type=>{try{if(process.platform!=='win32' && child.pid)process.kill(-child.pid,type);else child.kill(type);}catch(error){if(error.code!=='ESRCH')throw error;}};
        const stop=()=>{signal('SIGTERM');kill ||= setTimeout(()=>signal('SIGKILL'),2000);kill.unref();};
        activeProcesses.add(stop);
        const capture=target=>chunk=>{const available=Math.max(0,4194304-bytes);if(available)target.push(chunk.subarray(0,available));bytes+=chunk.length;if(bytes>4194304 && !truncated){truncated=true;stop();}};
        child.stdout.on('data',capture(stdout));child.stderr.on('data',capture(stderr));
        const timer=setTimeout(()=>{timedOut=true;stop();},Math.min(plan.timeoutMs || 30000,300000));
        const cleanup=()=>{clearTimeout(timer);clearTimeout(kill);activeProcesses.delete(stop);};
        child.on('error',error=>{cleanup();reject(fail('UNAVAILABLE',error.code==='ENOENT'?'Executable is missing. Install it in Dockerfile or configure deployment/services.json executables.':'The configured command could not start.'));});
        child.on('close',code=>{cleanup();resolve({exitCode:code,stdout:Buffer.concat(stdout),stderr:Buffer.concat(stderr),timedOut,truncated});});
    });
    const privileged=content=>{
        const raw=content?.request || content;
        if(!raw || typeof raw!=='object')throw fail('INVALID_REQUEST');
        const request=structuredClone(raw),payload=request.payload;
        if(payload?.scope && request.action==='system.process.exec'){
            const scope=processScopes.find(scope=>scope.scope===payload.scope);
            payload.cwd=payload.cwd?mapPath(payload.cwd):scope?.allowedCwdRoots[0] || root;
        }
        if(Array.isArray(payload?.operations))for(const operation of payload.operations)for(const field of ['path','from','to'])if(operation[field])operation[field]=mapPath(operation[field]);
        return core.executeHostPrivilegedAction(request,{pluginId,grantedCapabilities:grants,
        correlationId:content?.correlationId || crypto.randomUUID(),confirmPrivilegedAction:confirm,
        runGit:plan=>host.runGit(pluginId,{...plan,command:settings.executables?.[plan.command] || plan.command}),hostsPath:settings.hostsPath || '/etc/hosts',onAudit:event=>console.info('[host-action]',event.action,event.success?'OK':'FAILED'),
    },{runProcess:processRun});
    };
    const gateway=async(handler,content)=>{
        const address=settings.gateway?.url,token=process.env.WEB_APP_GATEWAY_TOKEN;
        if(!address)throw fail('CONFIGURATION_REQUIRED','Configure deployment/services.json gateway for '+handler+'. The application is running; this external service is not configured.');
        const url=new URL(address);if(url.protocol!=='https:' && !['localhost','127.0.0.1'].includes(url.hostname))throw fail('INVALID_REQUEST','Service gateways require HTTPS.');
        const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify({pluginId,handler,content}),redirect:'error',signal:AbortSignal.timeout(120000)});
        if(!response.ok)throw fail('UNAVAILABLE','The deployment service gateway rejected the request.');
        const value=await response.json();if(!value || typeof value!=='object')throw fail('UNAVAILABLE');return value;
    };
    let menu=null;
    const dispatch=async(handler,content)=>{
        const auth={'fdo.auth.start.v1':core.handleHostAuthBrokerStartRequest,'fdo.auth.refresh.v1':core.handleHostAuthBrokerRefreshRequest,'fdo.auth.logout.v1':core.handleHostAuthBrokerLogoutRequest,'fdo.session.request.v1':core.handleHostSessionRequest};
        if(auth[handler])return auth[handler](content,{pluginId,grantedCapabilities:grants,declaredCapabilities:grants});
        if(handler.startsWith('fdo.ai.')){
            requireGrant('system.ai');requireGrant(handler==='fdo.ai.assistants.list.v1'?'system.ai.assistants.list':'system.ai.request');
            const assistants=settings.aiAssistants || [];
            if(handler==='fdo.ai.assistants.list.v1')return {ok:true,assistants:assistants.map(({id,name,model,purpose,provider,default:preferred})=>({id,name,model,purpose,provider,default:preferred===true}))};
            if(settings.gateway?.url)return gateway(handler,content);
            const assistant=assistants.find(item=>item.id===content?.assistantId) || assistants.find(item=>item.default) || assistants[0];
            if(!assistant)return {ok:false,code:'AI_NO_ASSISTANTS',error:'Configure aiAssistants in deployment/services.json and its API key environment variable.'};
            const url=new URL(assistant.endpoint);if(url.protocol!=='https:' && !['localhost','127.0.0.1'].includes(url.hostname))throw fail('INVALID_REQUEST');
            const token=process.env[assistant.apiKeyEnvironment];if(!token)throw fail('CONFIGURATION_REQUIRED','Set the configured AI API key environment variable.');
            const response=await fetch(url,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({model:assistant.model,stream:false,messages:[{role:'user',content:JSON.stringify(content)}]}),redirect:'error',signal:AbortSignal.timeout(120000)});
            if(!response.ok)return {ok:false,code:'AI_REQUEST_FAILED',error:'The configured AI provider rejected the request.'};
            const result=await response.json(),text=result.choices?.[0]?.message?.content;
            if(typeof text!=='string' || !text)return {ok:false,code:'AI_EMPTY_RESPONSE',error:'The AI provider returned no text.'};
            return {ok:true,assistantId:assistant.id,resolution:content?.assistantId===assistant.id?'explicit':'default',[content?.task==='commit-message'?'commitMessage':content?.task==='summarize-command-output'?'text':'message']:text};
        }
        else if(handler==='fdo.tray.v1'){
            requireGrant('system.tray');
            if(content?.operation==='remove'){menu=null;return {ok:true};}
            if(content?.operation!=='set' || typeof content.tooltip!=='string' || content.tooltip.length>120 || !Array.isArray(content.items) || content.items.length>20 || !content.items.length)throw fail('INVALID_REQUEST');
            const ids=new Set();
            for(const item of content.items){if(typeof item.id!=='string' || !item.id || item.id.length>80 || ids.has(item.id) || typeof item.label!=='string' || !item.label || item.label.length>80 || typeof item.handler!=='string' || !item.handler || item.handler.length>120 || item.handler.startsWith('__') || item.handler.startsWith('fdo.'))throw fail('INVALID_REQUEST');ids.add(item.id);}
            menu={tooltip:content.tooltip,items:content.items.map(({id,label,handler,enabled})=>({id,label,handler,enabled:enabled!==false}))};
            return {ok:true};
        }
        else if(!/^fdo\.(auth|session)\./.test(handler))throw fail('INVALID_REQUEST','Unknown host service.');
        return gateway(handler,content);
    };
    return {menu:()=>menu,hostServices:{request:value=>endpoint.request(value)},endpoint,privileged,dispatch,
        lease({id,active}){if(id!==view.getStore())throw fail('ACCESS_DENIED');host.viewLease('web',pluginId,id,active===true);return {ok:true};},
        async elevate(command,options){requireGrant('sudo.prompt');if(!await confirm({action:'sudo.prompt',reason:options?.confirmMessage || 'Run configured privileged operation?',command}))return '';const response=await gateway('fdo.elevation.v1',{command,options});if(response.ok!==true || typeof response.stdout!=='string')throw fail('UNAVAILABLE','The elevation gateway returned an invalid response.');return response.stdout;},
        async close(){for(const stop of activeProcesses)stop();for(const item of confirmations.values()){clearTimeout(item.timer);item.resolve(false);}endpoint.close();await host.close();},
    };
}
