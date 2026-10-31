// Runs in the backend worker, not in the HTTP server. Returned module proxies
// preserve Node's internal transport dependencies without granting raw sockets.
export function installApplicationNetworkPolicy(policy) {
    const Module=require('node:module'),net=require('node:net'),originalLoad=Module._load,wrapped=new Map();
    const grants=new Set(policy.grantedCapabilities);
    const allowed=(transport,scheme,hostname,port)=>{
        const capability=['https','http','dns','tcp','udp'].includes(scheme)?scheme:transport==='websocket'?'websocket':scheme;
        if(!grants.has('system.network') || !grants.has('system.network.'+capability))return false;
        return policy.networkScopes.some(scope=>scope.allowedTransports.includes(transport) && scope.allowedSchemes.includes(scheme) &&
            scope.allowedHostPatterns.some(pattern=>pattern==='*' || pattern.toLowerCase()===hostname.toLowerCase() || pattern.startsWith('*.') && hostname.endsWith(pattern.slice(1)) && hostname!==pattern.slice(2)) &&
            scope.allowedPorts.some(value=>value==='*' || String(value)===String(port)));
    };
    const check=(transport,input)=>{
        const url=new URL(typeof input==='string' || input instanceof URL?input:input.url);
        const scheme=url.protocol.slice(0,-1),port=url.port || ({https:'443',http:'80',wss:'443',ws:'80'}[scheme]);
        if(url.username || url.password || !allowed(transport,scheme,url.hostname,port))throw new Error('Network destination is outside the exported capability policy.');
        return url;
    };
    if(typeof globalThis.fetch==='function') {
        const fetch=globalThis.fetch.bind(globalThis);
        globalThis.fetch=async(input,options={})=>{
            check('fetch',input);
            // Redirects must be requested explicitly so destinations cannot bypass
            // policy. Callers can inspect Location and make another checked call.
            if(options.redirect && options.redirect!=='error' && options.redirect!=='manual')throw new Error('Automatic fetch redirects are disabled by the exported destination policy.');
            return fetch(input,{...options,redirect:options.redirect || 'error'});
        };
    }
    if(globalThis.WebSocket) {
        const Original=globalThis.WebSocket;
        globalThis.WebSocket=class extends Original{constructor(url,...args){check('websocket',url);super(url,...args);}};
    }
    Module._load=function(name,parent,isMain) {
        const loaded=originalLoad.call(this,name,parent,isMain),id=name.replace(/^node:/,'');
        if(!['http','https','net','tls','dgram','dns','dns/promises'].includes(id))return loaded;
        if(wrapped.has(id))return wrapped.get(id);
        const proxy=new Proxy(loaded,{get(target,key){
            if(id==='dns' && key==='promises')return Module._load('node:dns/promises',parent,false);
            const value=Reflect.get(target,key);
            if(typeof value!=='function')return value;
            if(['http','https'].includes(id) && ['request','get'].includes(key))return (...args)=>{
                const first=args[0],options=typeof first==='string' || first instanceof URL?first:{url:`${first.protocol || id+':'}//${first.hostname || first.host || 'localhost'}:${first.port || (id==='https'?443:80)}${first.path || '/'}`};
                check('fetch',options);
                const second=args[1];
                if(typeof second==='object' && second && ['hostname','host','port','socketPath','createConnection','lookup'].some(name=>name in second))throw new Error('Transport overrides need a standalone network adapter.');
                if(first && typeof first==='object' && ['socketPath','createConnection','lookup'].some(name=>name in first))throw new Error('Transport overrides need a standalone network adapter.');
                return value.apply(target,args);
            };
            const socketTarget=args=>{const first=args[0];const options=typeof first==='object'?first:{port:first,host:typeof args[1]==='string'?args[1]:'127.0.0.1'};if(options.path || options.socketPath || !Number.isInteger(Number(options.port)) || Number(options.port)<1 || Number(options.port)>65535 || !allowed('tcp','tcp',options.host || options.servername || '127.0.0.1',options.port))throw new Error('TCP destination is outside the exported capability policy.');};
            if(['net','tls'].includes(id) && ['connect','createConnection'].includes(key))return (...args)=>{socketTarget(args);return value.apply(target,args);};
            if(id==='net' && key==='Socket' || id==='tls' && key==='TLSSocket')return class extends value{connect(...args){socketTarget(args);return super.connect(...args);}};
            if(id==='net' && key==='createServer')return ()=>{throw new Error('Inbound sockets require an explicitly deployed service, not plugin HTTP ingress.');};
            if(id==='dgram' && key==='createSocket')return (...args)=>{
                if(!grants.has('system.network') || !grants.has('system.network.udp'))throw new Error('UDP capability is not approved.');
                const socket=value.apply(target,args),send=socket.send.bind(socket),connect=socket.connect.bind(socket);
                const targetAllowed=(host,port)=>{if(!allowed('udp','udp',host || '127.0.0.1',port))throw new Error('UDP destination is outside the exported capability policy.');};
                let remote;
                socket.connect=(port,host,...rest)=>{targetAllowed(host,port);remote={host,port};return connect(port,host,...rest);};
                socket.send=(...items)=>{const values=typeof items.at(-1)==='function'?items.slice(0,-1):items;const tail=values.at(-1);const host=typeof tail==='string'?tail:remote?.host || '127.0.0.1';const port=typeof tail==='string'?values.at(-2):values.length===2?tail:values.length===4?tail:remote?.port;targetAllowed(host,port);return send(...items);};
                return socket;
            };
            if(['dns','dns/promises'].includes(id)) {
                if(!/^(?:lookup|resolve|reverse)/.test(String(key)))return ()=>{throw new Error('DNS configuration is deployment-owned.');};
                return (hostname,...args)=>{if(!allowed('dns','dns',hostname,''))throw new Error('DNS destination is outside the exported capability policy.');return value.call(target,hostname,...args);};
            }
            return value.bind(target);
        }});
        wrapped.set(id,proxy);return proxy;
    };
    // Keep the original net module loaded for Node internals before wrapping.
    void net;
}
