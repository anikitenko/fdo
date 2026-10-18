// Injected before untrusted plugin initialization. Uses only the private host
// bridge, never the synthetic iframe/UI transport. IPC carries plain records.
export const WORKER_LIVE_SOURCE = String.raw`
function requestHostOperation(operation,payload) {
    return sendHostServiceMessage({operation,payload});
}
function hostIterator(handle) {
    let ended=false;
    return {
        async next() {
            if(ended)return {done:true};
            const result=await requestHostOperation('next',{handle});
            if(result.done)ended=true;
            return result;
        },
        async return() {
            if(!ended){ended=true;await requestHostOperation('return',{handle});}
            return {done:true};
        },
        [Symbol.asyncIterator]() {return this;},
    };
}
async function watchHostSSHStatus(options) {
    const {handle}=await requestHostOperation('watch',options);
    return hostIterator(handle);
}
async function startHostSSHExecution(options) {
    const {handle}=await requestHostOperation('start',options);
    const result=requestHostOperation('result',{handle});
    result.catch(()=>{});
    let cancelPromise;
    return {events:hostIterator(handle),result,
        cancel:()=>cancelPromise ||= requestHostOperation('cancel',{handle})};
}
async function openHostSSHTerminal(options) {
    const {handle}=await requestHostOperation('terminal.open',options);
    const result=requestHostOperation('terminal.result',{handle});result.catch(()=>{});
    let ended=false,reading=false,closePromise,cancelPromise;
    const close=()=>closePromise ||= requestHostOperation('terminal.close',{handle}).then(value=>{ended=true;return value;});
    const output={
        async next(){
            if(ended)return {done:true};if(reading)throw hostServiceError('BACKPRESSURE');reading=true;
            try{const item=await requestHostOperation('terminal.next',{handle});if(item.done){ended=true;return {done:true};}
                const data=Buffer.from(item.value.dataBase64,'base64');return {done:false,value:{sequence:item.value.sequence,data:new Uint8Array(data)}};
            }finally{reading=false;}
        },
        async return(){await close();return {done:true};},
        [Symbol.asyncIterator](){return this;},
    };
    return {output,result,close,
        write:data=>requestHostOperation('terminal.write',{handle,dataBase64:Buffer.from(data).toString('base64')}).then(()=>{}),
        resize:(rows,columns)=>requestHostOperation('terminal.resize',{handle,rows,columns}).then(()=>{}),
        endInput:()=>requestHostOperation('terminal.eof',{handle}).then(()=>{}),
        cancel:()=>cancelPromise ||= requestHostOperation('terminal.cancel',{handle}),
    };
}
`;
