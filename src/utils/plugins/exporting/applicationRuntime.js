// Compiled into each export. The public ABI is retained; its desktop transport is removed.
export function applicationRuntime() {
    const fs=require('node:fs'),path=require('node:path'),{AsyncLocalStorage}=require('node:async_hooks');
    // Paths resolve inside the generated export, not this source-template directory.
    const configuration=require(path.join(__dirname,'../deployment/application.json'));
    const root=path.resolve(process.env.WEB_APP_DATA_DIR || '/data');
    fs.mkdirSync(root,{recursive:true,mode:0o700});
    process.env.FDO_SDK_STORAGE_ROOT=path.join(root,'storage');
    process.env.FDO_SDK_LOG_ROOT=path.join(root,'logs');
    const abi={...require(path.join(__dirname,'contract.cjs'))},registry=abi.PluginRegistry,stores=new Set(),handlers=new Set(),backend=new AsyncLocalStorage(),view=new AsyncLocalStorage();
    const services=require(path.join(__dirname,'services.cjs')).create({configuration,root,view});
    registry.configureStorage({rootDir:process.env.FDO_SDK_STORAGE_ROOT});
    registry.configureCapabilities({granted:configuration.capabilities.filter(id=>id!=='system.tray')});
    registry.assertHostApiCompatibility(configuration.hostContract.apiVersion);
    registry.configureHostServices(services.hostServices);
    const useStore=registry.useStore.bind(registry);
    registry.useStore=(...args)=>{const store=useStore(...args);stores.add(store);return store;};
    // Fail closed if a plugin attempts to replace the deployment-owned grants or transports.
    registry.configureCapabilities=()=>{throw new Error('Deployment capability grants are host-owned.');};
    registry.configureHostServices=()=>{throw new Error('Deployment service transports are host-owned.');};
    const registerHandler=registry.registerHandler.bind(registry);registry.registerHandler=(name,fn)=>{handlers.add(name);return registerHandler(name,fn);};
    let instance;
    const register=registry.registerPlugin.bind(registry);
    registry.registerPlugin=value=>{instance=value;return register(value);};
    let runtimeWindow={createBackendReq:(handler,content)=>invoke(handler,content),__FDO_AI:services.ai};
    Object.defineProperty(globalThis,'window',{configurable:true,get:()=>backend.getStore()?undefined:runtimeWindow,set:value=>{runtimeWindow=value;}});
    const wrap=value=>{
        if(!value || typeof value!=='object')return value;
        return new Proxy(value,{get(target,key){const item=Reflect.get(target,key,target);return typeof item==='function'?function(...args){const result=backend.run(true,()=>item.apply(target,args));if(result?.then)return result.then(wrap);return wrap(result);}:wrap(item);}});
    };
    for(const [Type,names] of [[abi.SecretStore,['set','get','delete','list']],[abi.SSHClient,['exec','listProfiles','start','watchStatus','openTerminal']]]) {
        for(const name of names)if(Type?.prototype[name]){const original=Type.prototype[name];Type.prototype[name]=function(...args){return backend.run(true,()=>{const result=original.apply(this,args);return result?.then?result.then(wrap):wrap(result);});};}
    }
    const invoke=async(handler,content,viewId)=>view.run(viewId || view.getStore(),async()=>{
        if(handler==='UI_MESSAGE')return invoke(content.handler,content.content);
        if(handler==='requestPrivilegedAction' || handler==='__host.privilegedAction')return services.privileged(content);
        if(handler==='__web.viewLease')return services.lease(content);
        if(handler.startsWith('fdo.'))return services.dispatch(handler,content);
        if(handler.startsWith('__host.'))throw new Error('Unknown host operation.');
        if(!handlers.has(handler))throw Object.assign(new Error('Unknown application handler.'),{code:'NOT_FOUND'});
        return registry.callHandler(handler,content);
    });
    globalThis.__FDO_AI={listAssistants:content=>services.dispatch('fdo.ai.assistants.list.v1',content),request:content=>services.dispatch('fdo.ai.request.v1',content)};
    globalThis.__FDO_AUTH_BROKER={start:content=>services.dispatch('fdo.auth.start.v1',content),refresh:content=>services.dispatch('fdo.auth.refresh.v1',content),logout:content=>services.dispatch('fdo.auth.logout.v1',content)};
    globalThis.__FDO_SESSION_REQUEST={request:content=>services.dispatch('fdo.session.request.v1',content)};
    abi.runWithSudo=async(command,options)=>{abi.requireCapability('sudo.prompt');return services.elevate(command,options);};
    return {abi,WebRegistry:registry,WebApplication:abi.FDO_SDK,WebSecretStore:abi.SecretStore,requireCapability:abi.requireCapability,invoke,menu:services.menu,
        async initialize(){
            if(!instance)throw new Error('The plugin did not register an instance.');
            const declared=instance.declareCapabilities?.() || [];
            if(!Array.isArray(declared) || declared.some(id=>!configuration.capabilities.includes(id==='system.hosts.write'?'system.host.write':id)))throw new Error('The plugin capability declaration differs from its reviewed export.');
            await instance.init();
        },
        async render(){const value=registry.callRenderer();return {html:JSON.parse(value.render),onLoad:JSON.parse(value.onLoad)};},
        async shutdown(){for(const store of stores){await store.flush?.();await store.dispose?.();}await services.close();},
    };
}
