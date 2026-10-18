const {ensure,failure} = require('./contracts.cjs');
const REQUEST = 'HOST_SERVICE_REQUEST_V1';
const RESPONSE = 'HOST_SERVICE_RESPONSE_V1';
const DISCONNECT = 'HOST_SERVICE_DISCONNECT_V1';
function attachHostServiceBridge(child, endpoint) {
    let closed = false;
    const pending = new Set();
    const send = message => {if (!closed) try {child.postMessage(message);} catch {close();}};
    const onMessage = message => {
        if (message?.type === DISCONNECT && Object.keys(message).length === 1) {close(); return;}
        if (message?.type !== REQUEST || closed) return;
        const id = message.requestId;
        if (typeof id !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(id)) return;
        if (Object.keys(message).some(key => !['type', 'requestId', 'request', 'operation', 'payload'].includes(key)) || pending.has(id) || pending.size >= (['terminal.close','terminal.cancel','terminal.eof'].includes(message.operation)?32:24)) {
            send({message: RESPONSE, content: {requestId: id, error: 'INVALID_REQUEST'}}); return;
        }
        pending.add(id);
        let response;
        try {
            if(message.operation!==undefined) {
                ensure(message.request===undefined && ['watch','start','next','return','result','cancel','terminal.open','terminal.next','terminal.write','terminal.resize','terminal.eof','terminal.result','terminal.cancel','terminal.close'].includes(message.operation) && typeof endpoint.operation==='function');
                response = endpoint.operation(message.operation,message.payload,id);
            } else {
                ensure(message.payload===undefined);
                response = endpoint.request(message.request,id);
            }
        } catch(error){response=Promise.reject(error);}
        Promise.resolve(response).then(result => {
            send({message: RESPONSE, content: {requestId: id, result}});
        }, error => send({message: RESPONSE, content: {requestId: id, error: failure(error?.code).code}}))
            .finally(() => pending.delete(id));
    };
    function close() {
        if (closed) return;
        closed = true; endpoint.close(); pending.clear();
        child.removeListener('message', onMessage); child.removeListener('exit', close); child.removeListener('error', close);
    }
    child.on('message', onMessage); child.once('exit', close); child.once('error', close);
    return close;
}
module.exports = {attachHostServiceBridge, REQUEST, RESPONSE, DISCONNECT};

function drainWorkerStorage(child, timeoutMs = 5000) {
    return new Promise(resolve => {
        const requestId = require('node:crypto').randomUUID();let finished=false;
        const done = success => {
            if(finished)return;finished=true;clearTimeout(timer);
            child.removeListener('message',reply);child.removeListener('exit',exit);child.removeListener('error',exit);
            resolve({success:success===true});
        };
        const reply = message => {if(message?.type==='HOST_STORAGE_SHUTDOWN_REPLY_V1'&&message.requestId===requestId)done(message.success);};
        const exit=()=>done(false);
        const timer=setTimeout(exit,timeoutMs);
        child.on('message',reply);child.once('exit',exit);child.once('error',exit);
        try{child.postMessage({message:'HOST_STORAGE_SHUTDOWN_V1',content:{requestId}});}catch{exit();}
    });
}
module.exports.drainWorkerStorage=drainWorkerStorage;
