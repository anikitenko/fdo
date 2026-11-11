/** @jest-environment node */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fork} from 'node:child_process';
import {buildPluginRuntimeBootstrapSource} from '../../src/utils/plugins/security/pluginRuntimeSecurity';
import {watchPluginWorker} from '../../src/utils/plugins/runtime/pluginWatchdog';
jest.mock('electron', () => ({app: {getPath: () => '/tmp'}}));

test('detects a real blocked worker event loop and recovers through the private heartbeat', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fdo-watchdog-'));
    fs.writeFileSync(path.join(root, 'bootstrap.cjs'), buildPluginRuntimeBootstrapSource());
    fs.writeFileSync(path.join(root, 'parent.cjs'), `
const {EventEmitter}=require('node:events');
const port=new EventEmitter();process.parentPort=port;
port.postMessage=message=>process.send(message);
process.on('message',message=>port.emit('message',{data:message}));
`);
    fs.writeFileSync(path.join(root, 'entry.cjs'), `
process.send({type:'fixture-ready'});
setTimeout(()=>{const until=Date.now()+600;while(Date.now()<until){}},150);
setInterval(()=>{},1000);
`);
    const child = fork(path.join(root, 'bootstrap.cjs'), [], {
        execArgv: ['-r', path.join(root, 'parent.cjs')], silent: true,
        env: {...process.env, FDO_PLUGIN_RUNTIME_ENTRY: path.join(root, 'entry.cjs'),
            FDO_PLUGIN_POLICY_JSON: JSON.stringify({blockedModules: []}), FDO_PLUGIN_CAPABILITIES: '',
            PLUGIN_HOME: root, PLUGIN_CODE_HOME: root},
    });
    child.postMessage = message => child.send(message);
    child.stdout.on('data', () => {}); child.stderr.on('data', () => {});
    let stop = () => {};
    let detected = false;
    let deadline;
    try {
        await new Promise((resolve, reject) => {
            deadline = setTimeout(() => reject(new Error('Heartbeat fixture did not recover')), 7000);
            child.once('error', reject);
            child.once('exit', code => reject(new Error(`Worker exited early: ${code}`)));
            child.on('message', message => {
                if (message?.type !== 'fixture-ready') return;
                stop = watchPluginWorker(child, status => {
                    if (status.status === 'unresponsive') detected = true;
                    if (status.status === 'responsive' && detected) resolve();
                }, {intervalMs: 50, timeoutMs: 100, missedLimit: 2});
            });
        });
        expect(detected).toBe(true);
    } finally {
        clearTimeout(deadline); stop();
        if (child.exitCode === null) {
            const exited = new Promise(resolve => child.once('exit', resolve));
            child.kill(); await exited;
        }
        fs.rmSync(root, {recursive: true, force: true});
    }
}, 10000);
