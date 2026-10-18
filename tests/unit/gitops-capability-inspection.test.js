/** @jest-environment node */
import {inspectGitOpsCapabilities} from '../../src/utils/gitops/inspectCapabilities';

test.each([
 `import {createSSHCapabilityBundle as ssh} from '@anikitenko/fdo-sdk';const permissions=ssh({monitorStatus:true});class App {declareCapabilities(){return permissions;}}`,
 `var sdk=require('@anikitenko/fdo-sdk');var permissions=(0,sdk.createSSHCapabilityBundle)({monitorStatus:true});class App {declareCapabilities(){return permissions;}}`,
 `const {createSSHCapabilityBundle:ssh}=require('@anikitenko/fdo-sdk');class App {declareCapabilities(){return ssh({monitorStatus:true});}}`,
])('inspects installed SDK helpers and constant aliases without executing candidate code',source=>{
 const result=inspectGitOpsCapabilities(`throw new Error('Candidate code must not execute');${source}`);
 expect(result.error).toBe('');expect(result.capabilities).toEqual(['secrets.consume','secrets.use','ssh.exec','ssh.profiles.list','ssh.status.watch','ssh.use']);
});
test('literal arrays, spreads and method-local constants produce exact canonical capabilities',()=>{
 expect(inspectGitOpsCapabilities(`class App {declareCapabilities(){const base=['storage'];return [...base,'storage.json','system.hosts.write'];}}`)).toEqual({capabilities:['storage','storage.json','system.host.write'],error:''});
});
test.each([
 `class App {declareCapabilities(){return process.env.PERMISSIONS.split(',');}}`,
 `function createSSHCapabilityBundle(){return ['ssh.exec'];}class App{declareCapabilities(){return createSSHCapabilityBundle();}}`,
 `let permissions=['storage'];permissions.push('ssh.exec');class App{declareCapabilities(){return permissions;}}`,
 `class App {declareCapabilities(){return ['unknown.permission'];}}`,
 `class App {declareCapabilities(){while(true){}return [];}}`,
 `class App {declareCapabilities=()=>['ssh.exec'];}`,
 `App.prototype.declareCapabilities=function(){return ['ssh.exec'];};`,
 `const App={declareCapabilities(){return ['ssh.exec'];}};`,
 `class App {['declareCapabilities'](){return ['ssh.exec'];}}`,
])('unresolved/mutable/unknown declarations fail closed',source=>expect(inspectGitOpsCapabilities(source).error).not.toBe(''));
