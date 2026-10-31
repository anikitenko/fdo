export function backendWorker() {
    // Serialized into worker.cjs; dependencies resolve from the generated project root.
    const path=require('node:path'),load=relative=>require(path.join(__dirname,relative));
    const requireOperation=operation=>{if(!['initialize','menu','render','invoke','shutdown'].includes(operation))throw new Error('Unknown backend operation.');};
    if(require('node:fs').existsSync(require('node:path').join(__dirname,'deployment/toolchain.lock.json')))load('runtime/tools.cjs').check({strict:true});
    const runtime=load('runtime/application.cjs');
    load('runtime/network.cjs').install(load('deployment/application.json').networkPolicy);
    // Converted application code registers its own instance and API handlers.
    load('backend/app.cjs');
    process.on('message',async request=>{
        const {id,operation,content}=request || {};
        if(!operation)return;
        try {
            requireOperation(operation);
            let result;
            if(operation==='initialize'){await runtime.initialize();result=true;}
            else if(operation==='menu')result=runtime.menu();
            else if(operation==='render') {
                result=await runtime.render();
                result.onLoad=load('runtime/helpers.cjs').resolveRenderOnLoadSource(result.onLoad);
            } else if(operation==='invoke')result=await runtime.invoke(content.handler,content.content,content.viewId);
            else if(operation==='shutdown'){await runtime.shutdown();result=true;}
            process.send?.({id,result});
        }catch(error){console.error('[web-backend]',operation,'failed');process.send?.({id,error:operation==='render' || ['CONFIGURATION_REQUIRED','LOCKED','NOT_FOUND','ACCESS_DENIED'].includes(error.code)?error.message:'Application operation failed.',code:error.code});}
    });
    process.on('disconnect',()=>process.exit(0));
    process.send?.({ready:true});
}

export function webServer() {
    const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
    const {fork}=require('node:child_process'),{parse}=require('@babel/parser'),esbuild=require('esbuild');
    const manifest=require(path.join(__dirname,'deployment/application.json'));
    const username=process.env.WEB_APP_USERNAME,password=process.env.WEB_APP_PASSWORD;
    if(!username || !password || password.length<24 || /[:\r\n]/.test(username))throw new Error('Set WEB_APP_USERNAME and WEB_APP_PASSWORD (at least 24 characters) before starting.');
    const credentials=crypto.createHash('sha256').update(username+':'+password).digest();
    const childEnv={...process.env};delete childEnv.WEB_APP_PASSWORD;
    const child=fork(path.join(__dirname,'worker.cjs'),[],{env:childEnv,stdio:['ignore','inherit','inherit','ipc']});
    let ready=false,stopping=false,sequence=0,queued=0,bootResolve,bootReject;
    const confirmations=new Map(),views=new Map();
    const pending=new Map(),boot=new Promise((resolve,reject)=>{bootResolve=resolve;bootReject=reject;});
    const crash=()=>{ready=false;bootReject(new Error('Application backend stopped.'));for(const item of pending.values()){clearTimeout(item.timer);item.reject(new Error('Application backend stopped.'));}pending.clear();if(!stopping)setTimeout(()=>process.exit(1),100).unref();};
    child.on('exit',crash);child.on('error',crash);
    child.on('message',message=>{
        if(message?.ready){bootResolve();return;}
        if(message?.confirmation){const item=message.confirmation;if(views.has(item.viewId) && confirmations.size<16){confirmations.set(item.id,{...item,expires:Date.now()+90000});}else child.send({confirmationReply:true,id:item.id,approved:false});return;}
        const item=pending.get(message?.id);if(!item)return;
        clearTimeout(item.timer);pending.delete(message.id);
        if(message.error)item.reject(Object.assign(new Error(message.error),{code:message.code}));else item.resolve(message.result);
    });
    const call=(operation,content)=>{
        if(queued>=32)return Promise.reject(new Error('Application is busy. Try again shortly.'));
        queued++;
        const run=()=>new Promise((resolve,reject)=>{
            if(!child.connected)return reject(new Error('Application backend is unavailable.'));
            const id=++sequence,timer=setTimeout(()=>{ready=false;child.kill('SIGKILL');reject(new Error('Backend operation timed out.'));},300000);
            pending.set(id,{resolve,reject,timer});
            child.send({id,operation,content},error=>{if(error){clearTimeout(timer);pending.delete(id);reject(error);}});
        });
        return run().finally(()=>{queued--;});
    };
    const startupTimer=setTimeout(()=>{bootReject(new Error('Backend startup timed out.'));child.kill('SIGKILL');},20000);
    void boot.then(()=>call('initialize')).then(()=>{ready=true;clearTimeout(startupTimer);console.log('Application backend ready.');},()=>{clearTimeout(startupTimer);child.kill();console.error('Application initialization failed.');});
    const send=(response,status,value,type='application/json')=>{
        response.writeHead(status,{'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Frame-Options':'DENY'});
        response.end(type==='application/json'?JSON.stringify(value):value);
    };
    const body=async request=>{
        if(!/^application\/json(?:;|$)/i.test(request.headers['content-type'] || '') || request.headers['x-web-app-request']!=='1')throw new Error('JSON API request required.');
        const chunks=[];let bytes=0;
        for await(const chunk of request){bytes+=chunk.length;if(bytes>1048576)throw new Error('Request exceeds 1 MB.');chunks.push(chunk);}
        return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    };
    const normalizeMarkup=markup=>markup
        .replace(/\bclass=/g,'className=').replace(/\bfor=/g,'htmlFor=')
        .replace(/\bstyle=(["'])(.*?)\1/g,(_match,_quote,style)=>{
            const values={};for(const declaration of style.split(';')){const colon=declaration.indexOf(':');if(colon<1)continue;const key=declaration.slice(0,colon).trim();values[key.startsWith('--')?key:key.replace(/-([a-z])/g,(_m,c)=>c.toUpperCase())]=declaration.slice(colon+1).trim();}
            return 'style={'+JSON.stringify(values)+'}';
        })
        .replace(/<style([^>]*)>([\s\S]*?)<\/style>/gi,(_match,attributes,css)=>'<style'+attributes+' dangerouslySetInnerHTML={{__html:'+JSON.stringify(css)+'}} />')
        .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi,'');
    const server=http.createServer(async(request,response)=>{
        const url=new URL(request.url,'http://localhost');
        if(request.method==='GET' && ['/health/live','/health/ready'].includes(url.pathname))return send(response,url.pathname.endsWith('ready') && !ready?503:200,{status:ready?'ready':'starting'});
        const authorization=request.headers.authorization || '';
        const supplied=crypto.createHash('sha256').update(authorization.startsWith('Basic ')?Buffer.from(authorization.slice(6),'base64').toString('utf8'):'').digest();
        if(!crypto.timingSafeEqual(credentials,supplied)){response.setHeader('WWW-Authenticate','Basic realm="Web application", charset="UTF-8"');return send(response,401,{error:'Sign in to this application.'});}
        const origin=request.headers.origin;
        if(origin && origin!==(process.env.WEB_APP_ORIGIN || `${request.socket.encrypted?'https':'http'}://${request.headers.host}`))return send(response,403,{error:'Origin is not allowed. Set WEB_APP_ORIGIN to the external HTTPS origin.'});
        try {
            if(request.method==='GET' && url.pathname==='/')return send(response,200,fs.readFileSync(path.join(__dirname,'frontend/index.html')),'text/html; charset=utf-8');
            const assets={'/assets/application.js':'frontend/application.js','/assets/view.js':'frontend/view.js'};
            if(request.method==='GET' && assets[url.pathname])return send(response,200,fs.readFileSync(path.join(__dirname,assets[url.pathname])),'text/javascript; charset=utf-8');
            if(!ready)return send(response,503,{error:'Application backend is not ready.'});
            if(request.method==='GET' && url.pathname==='/api/view') {
                const view=await call('render');
                if(view.html.length>1048576 || view.onLoad.length>524288)return send(response,400,{error:'View exceeds the rendering limit.'});
                const prefix='const __initialize = ',program=parse(prefix+view.onLoad,{plugins:['typescript']}).program;
                const expression=program.body[0]?.declarations?.[0]?.init;
                if(program.body.length!==1 || !expression)return send(response,400,{error:'The view initializer must contain one function or script expression.'});
                const callback=(prefix+view.onLoad).slice(expression.start,expression.end);
                const invoke=['FunctionExpression','ArrowFunctionExpression'].includes(expression.type)?'const initialize=('+callback+'); initialize();':'('+callback+');';
                const source='window.__webRender=()=> (<>'+normalizeMarkup(view.html)+'</>); window.__webInitialize=()=>{'+invoke+'};';
                const result=await esbuild.transform(source,{loader:'tsx',jsxFactory:'window.__webReact.React.createElement',jsxFragment:'window.__webReact.React.Fragment',target:'es2022'});
                const viewId=crypto.randomUUID();if(views.size>=128)views.delete(views.keys().next().value);views.set(viewId,Date.now());
                return send(response,200,{viewId,source:result.code,policy:manifest.networkPolicy,name:manifest.name,capabilities:manifest.capabilities});
            }
            if(request.method==='GET' && url.pathname==='/api/confirmations') {
                const viewId=request.headers['x-web-app-view'];if(!views.has(viewId))return send(response,403,{error:'Open the application before approving an operation.'});
                for(const [id,item] of confirmations)if(item.expires<Date.now())confirmations.delete(id);
                return send(response,200,{menu:await call('menu'),items:[...confirmations.values()].filter(item=>item.viewId===viewId).map(({id,detail})=>({id,detail}))});
            }
            if(request.method==='POST' && url.pathname==='/api/confirmations') {
                const payload=await body(request),item=confirmations.get(payload.id);
                if(!item || item.viewId!==request.headers['x-web-app-view'] || item.expires<Date.now())return send(response,403,{error:'This approval expired or belongs to another view.'});
                confirmations.delete(payload.id);child.send({confirmationReply:true,id:item.id,approved:payload.approved===true});return send(response,200,{ok:true});
            }
            if(request.method==='POST' && url.pathname==='/api/actions') {
                const payload=await body(request);
                if(!payload || typeof payload.handler!=='string' || payload.handler.length>200 || payload.handler.startsWith('__host.') && payload.handler!=='__host.privilegedAction' || payload.handler.startsWith('fdo.') && !/^fdo\.(?:ai\.(?:request|assistants\.list)|auth\.(?:start|refresh|logout)|session\.request|tray)\.v1$/.test(payload.handler))return send(response,400,{error:'Choose a converted application handler.'});
                const viewId=request.headers['x-web-app-view'];if(viewId && !views.has(viewId))return send(response,403,{error:'Application view expired.'});
                return send(response,200,{result:await call('invoke',{...payload,viewId})});
            }
            return send(response,404,{error:'Not found.'});
        }catch(error){console.error('[web-http] request failed');return send(response,error.code==='NOT_FOUND'?404:400,{error:error.message});}
    });
    server.requestTimeout=30000;server.headersTimeout=10000;server.maxRequestsPerSocket=100;
    const port=Number(process.env.PORT || 8080);
    if(!Number.isInteger(port) || port<0 || port>65535)throw new Error('PORT must be a valid TCP port.');
    server.listen(port,'0.0.0.0',()=>console.log('Web application listening on port '+server.address().port));
    const shutdown=async()=>{
        if(stopping)return;stopping=true;ready=false;
        const deadline=setTimeout(()=>{child.kill('SIGKILL');process.exit(1);},8000);deadline.unref();
        server.close();
        try{await call('shutdown');child.disconnect();clearTimeout(deadline);process.exitCode=0;}
        catch{child.kill('SIGKILL');process.exitCode=1;}
        server.closeAllConnections();
    };
    process.on('SIGTERM',shutdown);process.on('SIGINT',shutdown);
}

export async function webFrontend() {
    const requireCondition=(condition,message)=>{if(!condition)throw new Error(message);};
    const status=document.getElementById('status'),frame=document.getElementById('application');
    const fetchJson=async(url,options)=>{const response=await fetch(url,{...options,credentials:'same-origin'});const value=await response.json();if(!response.ok)throw new Error(value.error || 'Application request failed.');return value;};
    try {
        const view=await fetchJson('/api/view'),libraries=await fetch('/assets/view.js',{credentials:'same-origin'}).then(response=>{if(!response.ok)throw new Error('View libraries could not be loaded.');return response.text();});
        document.title=view.name;
        const toolbar=document.createElement('nav');toolbar.setAttribute('aria-label','Application actions');toolbar.style.cssText='position:fixed;right:12px;bottom:12px;display:flex;gap:8px;background:Canvas;padding:8px;border-radius:8px;box-shadow:0 2px 12px #0003';toolbar.hidden=true;document.body.appendChild(toolbar);
        let lastMenu='';
        const showMenu=menu=>{const signature=JSON.stringify(menu);if(signature===lastMenu)return;lastMenu=signature;toolbar.replaceChildren();toolbar.hidden=!menu;if(menu)for(const item of menu.items){const button=document.createElement('button');button.type='button';button.textContent=item.label;button.disabled=!item.enabled;button.onclick=async()=>{button.disabled=true;try{await fetchJson('/api/actions',{method:'POST',headers:{'Content-Type':'application/json','X-Web-App-Request':'1','X-Web-App-View':view.viewId},body:JSON.stringify({handler:item.handler,content:{source:'tray',actionId:item.id}})});}catch(error){status.hidden=false;status.textContent=error.message;}finally{button.disabled=!item.enabled;}};toolbar.appendChild(button);}};
        const lease=()=>fetchJson('/api/actions',{method:'POST',headers:{'Content-Type':'application/json','X-Web-App-Request':'1','X-Web-App-View':view.viewId},body:JSON.stringify({handler:'__web.viewLease',content:{id:view.viewId,active:!document.hidden}})}).catch(()=>{});
        void lease();const leaseTimer=setInterval(lease,10000);document.addEventListener('visibilitychange',lease);
        const approving=new Set();
        const approvalTimer=setInterval(async()=>{try{const value=await fetchJson('/api/confirmations',{headers:{'X-Web-App-View':view.viewId}});showMenu(value.menu);for(const item of value.items){if(approving.has(item.id))continue;approving.add(item.id);const approved=window.confirm('Allow this operation?\n\n'+JSON.stringify(item.detail,null,2));await fetchJson('/api/confirmations',{method:'POST',headers:{'Content-Type':'application/json','X-Web-App-Request':'1','X-Web-App-View':view.viewId},body:JSON.stringify({id:item.id,approved})});}}catch{/* Retry after a transient connection failure. */}},1000);
        window.addEventListener('pagehide',()=>{clearInterval(approvalTimer);clearInterval(leaseTimer);},{once:true});
        const nonce=crypto.randomUUID(),token=crypto.randomUUID();
        window.addEventListener('message',async event=>{
            if(event.source!==frame.contentWindow || event.data?.token!==token)return;
            const request=event.data;
            if(request.type==='view-ready'){status.textContent='';status.hidden=true;return;}
            if(request.type==='view-error'){status.hidden=false;status.textContent=request.error;return;}
            if(request.type!=='action' || typeof request.id!=='string')return;
            let result,error;
            try {
                let handler=request.handler,content=request.content;
                if(handler==='UI_MESSAGE'){handler=content?.handler;content=content?.content;}
                if(handler==='fdo.browser.open.v1') {
                    const url=new URL(content.url);requireCondition(['https:','http:'].includes(url.protocol),'Only HTTP(S) links can be opened.');
                    window.open(url.href,'_blank','noopener,noreferrer');result={ok:true,url:url.href};
                } else if(handler==='requestPrivilegedAction' || handler==='__host.privilegedAction') {
                    const action=content?.request || content;
                    if(['system.clipboard.read','system.clipboard.write'].includes(action?.action)) {
                        requireCondition(view.capabilities.includes('system.host.write') && view.capabilities.includes(action.action),'Clipboard capability is not approved.');
                        const value=action.action.endsWith('read')?{text:await navigator.clipboard.readText()}:await navigator.clipboard.writeText(action.payload?.text || '').then(()=>({written:true}));
                        result={correlationId:content.correlationId,ok:true,result:value};
                    } else result=(await fetchJson('/api/actions',{method:'POST',headers:{'Content-Type':'application/json','X-Web-App-Request':'1','X-Web-App-View':view.viewId},body:JSON.stringify({handler,content})})).result;
                } else result=(await fetchJson('/api/actions',{method:'POST',headers:{'Content-Type':'application/json','X-Web-App-Request':'1','X-Web-App-View':view.viewId},body:JSON.stringify({handler,content})})).result;
            }catch(failure){error=failure.message;}
            frame.contentWindow.postMessage({type:'action-result',token,id:request.id,result,error},'*');
        });
        const boot=`(${iframeRuntime.toString()})(${JSON.stringify({token,policy:view.policy})});`;
        const scripts=[libraries,view.source,boot].map(source=>'<script nonce="'+nonce+'">'+source.replace(/<\/script/gi,'<\\/script')+'</script>').join('');
        const connections=new Set();
        if(view.capabilities.includes('system.network'))for(const scope of view.policy.networkScopes)for(const scheme of scope.allowedSchemes) {
            if(!['https','http','wss','ws'].includes(scheme) || !view.capabilities.includes('system.network.'+(['ws','wss'].includes(scheme)?'websocket':scheme)))continue;
            for(const host of scope.allowedHostPatterns)for(const port of scope.allowedPorts) {
                requireCondition(/^(?:\*|(?:\*\.)?[A-Za-z0-9.-]+|\[?::1]?)$/.test(host),'Browser destination policy needs a supported hostname.');
                connections.add(host==='*' && port==='*'?scheme+':':scheme+'://'+(host==='::1'?'[::1]':host)+':'+port);
            }
        }
        const connect=connections.size?[...connections].join(' '):"'none'";
        frame.srcdoc='<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'nonce-'+nonce+'\'; style-src \'unsafe-inline\'; img-src data: blob:; font-src data:; connect-src '+connect+'; form-action \'none\'; base-uri \'none\';"></head><body><main id="web-root"></main>'+scripts+'</body></html>';
    }catch(error){status.textContent=error.message;status.hidden=false;}
}

export function iframeRuntime({token,policy}) {
    const send=value=>parent.postMessage({...value,token},'*'),pending=new Map();
    window.createBackendReq=(handler,content)=>new Promise((resolve,reject)=>{
        if(pending.size>=32)return reject(new Error('Too many pending application actions.'));
        const id=crypto.randomUUID(),timer=setTimeout(()=>{pending.delete(id);reject(new Error('Application action timed out.'));},300000);
        pending.set(id,{resolve,reject,timer});send({type:'action',id,handler,content});
    });
    window.addEventListener('message',event=>{
        if(event.source!==parent || event.data?.token!==token || event.data.type!=='action-result')return;
        const item=pending.get(event.data.id);if(!item)return;clearTimeout(item.timer);pending.delete(event.data.id);
        if(event.data.error)item.reject(new Error(event.data.error));else item.resolve(event.data.result);
    });
    window.waitForElement=async selector=>{
        const existing=document.querySelector(selector);if(existing)return existing;
        return new Promise((resolve,reject)=>{
            const observer=new MutationObserver(()=>{const element=document.querySelector(selector);if(element){clearTimeout(timer);observer.disconnect();resolve(element);}});
            const timer=setTimeout(()=>{observer.disconnect();reject(new Error('Element did not appear: '+selector));},5000);
            observer.observe(document,{childList:true,subtree:true});
        });
    };
    const allow=(input,transport)=>{
        const url=new URL(typeof input==='string'?input:input.url || input,location.href),scheme=url.protocol.slice(0,-1),port=url.port || (['https','wss'].includes(scheme)?'443':'80');
        const capability=transport==='websocket'?'websocket':scheme;
        if(!policy.grantedCapabilities.includes('system.network') || !policy.grantedCapabilities.includes('system.network.'+capability) ||
            !policy.networkScopes.some(scope=>scope.allowedTransports.includes(transport) && scope.allowedSchemes.includes(scheme) && scope.allowedHostPatterns.some(host=>host==='*' || host===url.hostname || host.startsWith('*.') && url.hostname.endsWith(host.slice(1))) && scope.allowedPorts.some(value=>value==='*' || String(value)===port)))throw new Error('Network destination is outside the exported policy.');
    };
    const fetch=window.fetch.bind(window);window.fetch=(input,options={})=>{allow(input,'fetch');return fetch(input,{...options,redirect:'error'});};
    const open=XMLHttpRequest.prototype.open;XMLHttpRequest.prototype.open=function(method,url,...args){allow(url,'xhr');return open.call(this,method,url,...args);};
    for(const [name,transport] of [['WebSocket','websocket'],['EventSource','eventsource']])if(window[name]){const Original=window[name];window[name]=class extends Original{constructor(url,...args){allow(url,transport);super(url,...args);}};}
    document.addEventListener('submit',event=>event.preventDefault());
    document.addEventListener('click',event=>{const link=event.target.closest('a[href]');if(link){event.preventDefault();window.createBackendReq('fdo.browser.open.v1',{url:link.href}).catch(error=>send({type:'view-error',error:error.message}));}});
    try {
        const {React,createRoot,flushSync}=window.__webReact,root=document.getElementById('web-root');
        flushSync(()=>createRoot(root).render(window.__webRender()));
        const view=window.__createView(window.__webUi,()=>root,window);
        const charts=window.__installWebCharts(window);
        window.__installWebTerminal?.(window);
        window.loadFdoUi=async()=>view.api;
        view.bindMarkupOpeners();
        window.addEventListener('pagehide',()=>{view.dispose();charts.dispose();},{once:true});
        Promise.resolve(view.runOnLoad(window.__webInitialize)).then(()=>send({type:'view-ready'}),error=>send({type:'view-error',error:error.message}));
    }catch(error){send({type:'view-error',error:error.message});}
}
