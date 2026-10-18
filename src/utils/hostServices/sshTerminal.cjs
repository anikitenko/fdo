'use strict';
// HOST ONLY reference adapter over a dedicated, already authenticated/pinned ssh2 Client.
// Host performs profile/interactive/X11 authorization BEFORE calling this function.
const { createX11Forwarding } = require('./x11Forwarding.cjs');
const failure = code => Object.assign(new Error(code), { code });
function openSSHTerminal({ client, options, authorize, localX11, onDispose = () => {} }) {
    return new Promise((resolve, reject) => {
        let stream, gate, done = false, published = false, resultResolve, resultReject;
        let waiter, queue = [], bytes = 0, sequence = 0, exitCode = null, exitSignal = null;
        let idleTimer, sessionTimer, inputEnded = false, reading = false, pendingInput = 0, pendingOps = 0;
        let writeTail = Promise.resolve(), cancelPromise;
        const result = new Promise((a,b) => { resultResolve = a; resultReject = b; }); result.catch(() => {});
        const safe = e => ['ACCESS_DENIED','X11_UNSUPPORTED','X11_UNAVAILABLE','X11_AUTH_UNAVAILABLE','X11_FORWARDING_DENIED'].includes(e?.code) ? e.code : 'CONNECTION_FAILED';
        const verify = () => { authorize('terminal'); if (options.x11) authorize(options.x11.mode); };
        const finish = (reason, code) => {
            if (done) return;
            done = true; clearTimeout(idleTimer); clearTimeout(sessionTimer); clearTimeout(openTimer);
            client.removeListener('error', connectionError); client.removeListener('close', disconnected); client.on('error', () => {});
            // X11 closes even if the consumer never drains terminal output.
            gate?.close(); stream?.destroy(); client.destroy(); gate?.dispose(); onDispose();
            if (code) { resultReject(failure(code)); queue = []; bytes = 0; waiter?.reject(failure(code)); }
            else {
                resultResolve({ reason, exitCode: reason === 'exited' ? exitCode : null,
                    signal: reason === 'exited' ? exitSignal : null,
                    remoteProcessStopped: reason === 'exited' ? true : null });
                waiter?.resolve({ done: true });
            }
            waiter = undefined;
            if (!published) reject(failure(code || 'SESSION_CLOSED'));
        };
        const touch = () => {
            clearTimeout(idleTimer);
            idleTimer = setTimeout(() => finish(null, 'IDLE_TIMEOUT'), options.idleTimeoutMs);
        };
        const connectionError = () => finish(null, 'CONNECTION_FAILED');
        const disconnected = () => finish(null, 'CONNECTION_FAILED');
        const openTimer = setTimeout(() => finish(null, 'TIMEOUT'), 10000);
        client.on('error', connectionError); client.on('close', disconnected);
        try {
            verify();
            if (options.x11) gate = createX11Forwarding({client,local:localX11,mode:options.x11.mode,authorize});
            client.shell({term:options.term,rows:options.rows,cols:options.columns,width:0,height:0},
                gate ? {x11:gate.request} : {}, (error, channel) => {
                    if (done) { channel?.destroy(); return; }
                    if (error || !channel) { finish(null, gate ? 'X11_FORWARDING_DENIED' : 'CONNECTION_FAILED'); return; }
                    stream = channel;
                    try { verify(); } catch { finish(null, 'ACCESS_DENIED'); return; }
                    clearTimeout(openTimer); touch();
                    sessionTimer = setTimeout(() => finish(null, 'SESSION_LIMIT'), options.sessionTimeoutMs);
                    const pause = () => { stream.pause(); stream.stderr.pause(); };
                    const resume = () => { if (!done && bytes < 65536) { stream.resume(); stream.stderr.resume(); } };
                    const output = chunk => {
                        if (done) return;
                        try { verify(); } catch { finish(null, 'ACCESS_DENIED'); return; }
                        // Includes both PTY stdout and any provider extended data, in observed order.
                        if (!Buffer.isBuffer(chunk) || bytes + chunk.length > 262144) { finish(null, 'BACKPRESSURE'); return; }
                        for (let offset = 0; offset < chunk.length; offset += 32768) {
                            const data = new Uint8Array(chunk.subarray(offset, offset + 32768));
                            const event = {sequence:sequence++,data};
                            if (waiter) { const w = waiter; waiter = undefined; w.resolve({done:false,value:event}); }
                            else { queue.push(event); bytes += data.length; }
                        }
                        if (bytes >= 65536) pause();
                    };
                    stream.on('data', output); stream.stderr.on('data', output);
                    stream.on('error', connectionError); stream.stderr.on('error', connectionError);
                    stream.on('exit', (code, signal) => { exitCode = Number.isSafeInteger(code) ? code : null; exitSignal = typeof signal === 'string' ? signal : null; });
                    stream.once('close', () => finish(exitCode !== null || exitSignal !== null ? 'exited' : 'closed'));
                    const live = () => { verify(); if (done) throw failure('SESSION_CLOSED'); };
                    const enqueue = (size, task) => {
                        try { live(); } catch (e) { return Promise.reject(e); }
                        if (pendingOps >= 32 || pendingInput + size > 65536) return Promise.reject(failure('BACKPRESSURE'));
                        pendingOps++; pendingInput += size;
                        const work = writeTail.then(() => { live(); touch(); return task(); });
                        writeTail = work.catch(() => {});
                        return work.finally(() => { pendingOps--; pendingInput -= size; });
                    };
                    published = true;
                    resolve({result,
                        output:{[Symbol.asyncIterator]() { return {
                            next() {
                                try { verify(); } catch { finish(null,'ACCESS_DENIED'); return Promise.reject(failure('ACCESS_DENIED')); }
                                if (reading) return Promise.reject(failure('BACKPRESSURE'));
                                if (queue.length) {const value=queue.shift();bytes-=value.data.length;resume();return Promise.resolve({done:false,value});}
                                if (done) return result.then(()=>({done:true}));
                                reading=true;
                                return new Promise((a,b)=>{waiter={resolve:a,reject:b};}).finally(()=>{reading=false;});
                            },
                            async return() {queue=[];bytes=0;finish('closed');return {done:true};},
                        };}},
                        write(data) {
                            if (!(data instanceof Uint8Array) || data.byteLength > 32768 || inputEnded) return Promise.reject(failure('INVALID_REQUEST'));
                            const copy=Buffer.from(data);
                            return enqueue(copy.length,()=>new Promise((a,b)=>stream.write(copy,e=>e?b(failure('CONNECTION_FAILED')):a())));
                        },
                        resize(rows, columns) {
                            if (!Number.isInteger(rows)||!Number.isInteger(columns)||rows<1||columns<1||rows>1000||columns>1000) return Promise.reject(failure('INVALID_REQUEST'));
                            return enqueue(0,async()=>{stream.setWindow(rows,columns,0,0);});
                        },
                        endInput() {if(inputEnded)return Promise.resolve();inputEnded=true;return enqueue(0,()=>new Promise(a=>stream.end(a)));},
                        async close() {queue=[];bytes=0;finish('closed');},
                        cancel() {return cancelPromise ||= (async()=>{if(!done)try{stream.signal('INT');}catch{}finish('cancelled');return {remoteProcessStopped:null};})();},
                    });
                });
        } catch(e) { finish(null, safe(e)); }
    });
}
module.exports = { openSSHTerminal };
