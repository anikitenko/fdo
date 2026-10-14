/** @jest-environment node */
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import http from 'node:http';
import fs from 'node:fs/promises';
import spawn from 'cross-spawn';
import {runCodexHookCommand, prepareCodexHookBridge} from '../../src/utils/ai/codex/codexHookRuntime';
jest.mock('cross-spawn',()=>jest.fn());
const hook={id:'fixture',name:'Team context',event:'PreToolUse',toolPattern:'mcp__*',command:'node',args:['/path with spaces/hook.js'],cwd:'/configured',environment:{TEAM_TOKEN:'private'},timeoutSeconds:5};
let child, kill;
beforeEach(()=>{
    child=new EventEmitter();child.pid=424242;child.kill=jest.fn();child.stdout=new PassThrough();child.stderr=new PassThrough();child.stdin=new PassThrough();
    spawn.mockReturnValue(child);kill=jest.spyOn(process,'kill').mockImplementation(()=>true);
});
afterEach(()=>{jest.restoreAllMocks();jest.clearAllMocks();jest.useRealTimers();});
test('uses literal argv and a limited environment, sends stdin JSON, and survives observer errors',async()=>{
    const notify=jest.fn(()=>{throw new Error('observer unavailable');});
    const pending=runCodexHookCommand(hook,{hook_event_name:'PreToolUse',tool_input:{value:'$LITERAL'}},{onActivity:notify});
    expect(spawn).toHaveBeenCalledWith('node',hook.args,expect.objectContaining({shell:false,cwd:'/configured',env:expect.objectContaining({TEAM_TOKEN:'private'})}));
    expect(JSON.parse(child.stdin.read().toString()).tool_input.value).toBe('$LITERAL');
    const text='{"systemMessage":"Привіт"}';const bytes=Buffer.from(text);const split=bytes.indexOf(0xd0)+1;
    child.stdout.write(bytes.subarray(0,split));child.stdout.write(bytes.subarray(split));child.emit('exit',0);child.emit('close',0);
    expect((await pending).stdout).toBe(text);expect(notify).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(notify.mock.calls)).not.toContain('private');
});
test('timeout and cancellation stop the configured process and settle promptly',async()=>{
    jest.useFakeTimers();const pending=runCodexHookCommand(hook,{});const timeout=expect(pending).rejects.toThrow('timed out');
    jest.advanceTimersByTime(5000);await timeout;expect(kill).toHaveBeenCalled();
    const abort=new AbortController();const cancelled=runCodexHookCommand(hook,{}, {signal:abort.signal});const rejection=expect(cancelled).rejects.toThrow('cancelled');abort.abort();await rejection;
    expect(jest.getTimerCount()).toBe(0);
});
test('rejects oversized stdout rather than passing a partial hook result',async()=>{
    const pending=runCodexHookCommand(hook,{});const rejection=expect(pending).rejects.toThrow('64 KiB');child.stdout.write('x'.repeat(65537));await rejection;expect(kill).toHaveBeenCalled();
});
function fakeHost(){
    let dispatch;const host=new EventEmitter();host.listen=(_port,_address,ready)=>ready();host.address=()=>({port:45678});host.closeAllConnections=jest.fn();host.close=callback=>callback();
    jest.spyOn(http,'createServer').mockImplementation(handler=>{dispatch=handler;return host;});jest.spyOn(fs,'access').mockResolvedValue();
    return {dispatch:(...args)=>dispatch(...args)};
}
test('bridge preserves native deny semantics and never places user environment secrets in its configuration',async()=>{
    const host=fakeHost();const bridge=await prepareCodexHookBridge([hook]);
    expect(JSON.stringify(bridge.config)).not.toContain('private');expect(bridge.config.hooks.PreToolUse[0].matcher).toBe('^mcp__.*$');
    const req=new PassThrough();req.url='/hooks/fixture';req.method='POST';req.headers={authorization:`Bearer ${bridge.env.FDO_CODEX_HOOK_TOKEN}`};
    const res=new EventEmitter();res.destroyed=false;res.writableEnded=false;res.writeHead=jest.fn();res.end=jest.fn(()=>{res.writableEnded=true;});
    const pending=host.dispatch(req,res);req.end(JSON.stringify({hook_event_name:'PreToolUse'}));
    await new Promise(resolve=>setImmediate(resolve));child.stderr.write('Denied by team policy');child.emit('close',2);await pending;
    expect(JSON.parse(res.end.mock.calls[0][0])).toEqual({hookSpecificOutput:{hookEventName:'PreToolUse',permissionDecision:'deny',permissionDecisionReason:'Denied by team policy'}});await bridge.close();
});
test('Windows adapter is encoded data and Interrupt respects the native three-second cap',async()=>{
    fakeHost();const bridge=await prepareCodexHookBridge([{...hook,event:'Interrupt',timeoutSeconds:3}],{platform:'win32'});
    const command=bridge.config.hooks.Interrupt[0].hooks[0];expect(command.timeout).toBe(3);expect(command.command).toContain('-EncodedCommand');expect(command.command).not.toContain('private');await bridge.close();
});
