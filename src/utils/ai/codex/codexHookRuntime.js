import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomBytes, randomUUID} from 'node:crypto';
import spawn from 'cross-spawn';
import {getDefaultEnvironment} from '@modelcontextprotocol/sdk/client/stdio.js';
import {hookMatcher} from './codexHooks';

export function runCodexHookCommand(hook, input, {signal, onActivity = () => {}} = {}) {
    return new Promise((resolve, reject) => {
        if (signal?.aborted) {reject(new Error('Hook cancelled.')); return;}
        const notify = activity => {try {onActivity(activity);} catch { /* Observers must not interrupt process cleanup. */ }};
        const started = Date.now(), id = randomUUID();
        const commandPath = [process.env.PATH || '', ...(process.platform === 'win32' ? [path.join(process.env.APPDATA || '', 'npm')] : ['/opt/homebrew/bin','/usr/local/bin',path.join(os.homedir(),'.local/bin')])].join(path.delimiter);
        const child = spawn(hook.command, hook.args, {cwd: hook.cwd || os.homedir(), env:{...getDefaultEnvironment(), PATH:commandPath, ...hook.environment}, shell:false, windowsHide:true, detached:process.platform !== 'win32', stdio:['pipe','pipe','pipe']});
        child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
        let stdout = '', stderr = '', settled = false, timer;
        const stop = () => {
            if (!child.pid) return;
            if (process.platform === 'win32') {
                const killer = spawn(path.join(process.env.SystemRoot || 'C:\\Windows','System32','taskkill.exe'), ['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});killer.on('error',()=>{});
            } else {try {process.kill(-child.pid,'SIGKILL');} catch {child.kill('SIGKILL');}}
        };
        const finish = (error, code) => {
            if (settled) return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',cancel);
            notify({id,hookName:hook.name,event:hook.event,status:error?'failed':code===0?'completed':code===2?'blocked':'failed',durationMs:Date.now()-started});
            if(error) reject(error);else resolve({exitCode:code,stdout,stderr,durationMs:Date.now()-started});
        };
        const cancel = () => {stop();finish(new Error('Hook cancelled.'));};
        notify({id,hookName:hook.name,event:hook.event,status:'started'});
        timer=setTimeout(()=>{stop();finish(new Error(`Hook timed out after ${hook.timeoutSeconds} seconds.`));},hook.timeoutSeconds*1000);
        signal?.addEventListener('abort',cancel,{once:true});
        child.on('error',()=>finish(new Error('Unable to start hook. Check the installed command, arguments, environment, and working directory.')));
        child.on('exit',()=>{if(process.platform !== 'win32')stop();});
        child.on('close',code=>finish(null,code ?? 1));
        child.stdout.on('data',chunk=>{if(settled)return;stdout+=chunk;if(Buffer.byteLength(stdout)>65536){stop();finish(new Error('Hook output exceeded 64 KiB. Return a concise result.'));}});
        child.stderr.on('data',chunk=>{stderr=(stderr+chunk).slice(-16384);});
        child.stdin.on('error',()=>{});child.stdin.end(JSON.stringify(input));
    });
}
function blockOutput(event, reason) {
    if(event==='PreToolUse')return {hookSpecificOutput:{hookEventName:event,permissionDecision:'deny',permissionDecisionReason:reason}};
    if(['UserPromptSubmit','Stop','PostToolUse'].includes(event))return {decision:'block',reason};
    return {continue:false,stopReason:reason};
}
export async function prepareCodexHookBridge(hooks, {platform=process.platform, onActivity=()=>{}}={}) {
    if(!hooks.length)return {ports:[],env:{},config:{hooks:{}},close:async()=>{}};
    let adapter;
    if(platform==='win32') {
        adapter=path.join(process.env.SystemRoot || 'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
        await fs.access(adapter).catch(()=>{throw new Error('Windows PowerShell is required to connect Codex hooks to FDO.');});
    } else {
        adapter='/usr/bin/curl';await fs.access(adapter).catch(()=>{throw new Error('Install curl at /usr/bin/curl to use Codex hooks on this platform.');});
    }
    const token=randomBytes(32).toString('hex'), pending=new Set();let closed=false;
    const host=http.createServer(async(req,res)=>{
        const hook=hooks.find(h=>req.url===`/hooks/${h.id}`);
        if(closed||!hook||req.method!=='POST'||req.headers.authorization!==`Bearer ${token}`){res.writeHead(403);res.end();return;}
        const abort=new AbortController();pending.add(abort);res.on('close',()=>{if(!res.writableEnded)abort.abort();});
        try {
            req.setEncoding('utf8');
            let body='';for await(const chunk of req){body+=chunk;if(Buffer.byteLength(body)>1024*1024)throw new Error('Hook event exceeds 1 MiB.');}
            const input=JSON.parse(body);if(input.hook_event_name!==hook.event)throw new Error('Unexpected hook event.');
            const result=await runCodexHookCommand(hook,input,{signal:abort.signal,onActivity});
            if(!res.destroyed){
                if(result.exitCode!==0 && result.exitCode!==2)throw new Error('Hook command failed.');
                res.writeHead(200,{'Content-Type':'application/json'});
                res.end(result.exitCode===2?JSON.stringify(blockOutput(hook.event,result.stderr.trim()||'Blocked by configured hook.')):result.stdout);
            }
        } catch {if(!res.destroyed){res.writeHead(500);res.end('Hook failed. Check its command and timeout in AI Extensions.');}}
        finally{pending.delete(abort);}
    });
    await new Promise((resolve,reject)=>{host.once('error',reject);host.listen(0,'127.0.0.1',resolve);});
    const port=host.address().port, config={hooks:{}};
    for(const hook of hooks){
        const url=`http://127.0.0.1:${port}/hooks/${hook.id}`;
        let command;
        if(platform==='win32') {
            const script=`$ErrorActionPreference='Stop';try {$body=[Console]::In.ReadToEnd();$r=Invoke-WebRequest -UseBasicParsing -Uri '${url}' -Method Post -ContentType 'application/json' -Headers @{Authorization=('Bearer '+$env:FDO_CODEX_HOOK_TOKEN)} -Body $body -TimeoutSec ${hook.timeoutSeconds+2};[Console]::Out.Write($r.Content)}catch{[Console]::Error.Write('FDO hook failed');exit 1}`;
            command=`"${adapter}" -NoProfile -NonInteractive -EncodedCommand ${Buffer.from(script,'utf16le').toString('base64')}`;
        } else command=`${adapter} --silent --show-error --fail --noproxy '*' --max-time ${hook.timeoutSeconds+2} -H "Authorization: Bearer $FDO_CODEX_HOOK_TOKEN" -H 'Content-Type: application/json' --data-binary @- '${url}'`;
        const matcher=hookMatcher(hook);
        (config.hooks[hook.event] ||= []).push({...(matcher?{matcher}:{}),hooks:[{type:'command',command,timeout:hook.event==='Interrupt'?3:hook.timeoutSeconds+3,statusMessage:`FDO hook: ${hook.name}`} ]});
    }
    return {ports:[port],env:{FDO_CODEX_HOOK_TOKEN:token},config,
        close:async()=>{if(closed)return;closed=true;for(const abort of pending)abort.abort();host.closeAllConnections();await new Promise(resolve=>host.close(resolve));}};
}
