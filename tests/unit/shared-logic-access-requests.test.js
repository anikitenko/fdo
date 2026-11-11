/** @jest-environment node */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import PluginORM from '../../src/utils/persistence/PluginORM';
import {targetFromCapability, capability} from '../../src/utils/plugins/runtime/sharedLogicContracts.cjs';

const target={providerId:'website-provider',name:'website-availability',version:1};
let home,file;
beforeEach(()=>{home=fs.mkdtempSync(path.join(os.tmpdir(),'fdo-shared-requests-'));file=path.join(home,'plugins.json');fs.writeFileSync(file,JSON.stringify({plugins:[{id:'consumer',capabilities:[]},{id:target.providerId,capabilities:[]}]}));});
afterEach(()=>{jest.restoreAllMocks();fs.rmSync(home,{recursive:true,force:true});});
test('parses exact capability targets including dotted provider IDs and rejects wildcards',()=>{
    expect(targetFromCapability('plugins.shared.call.provider.with.dots.website-availability.v12')).toEqual({providerId:'provider.with.dots',name:'website-availability',version:12});
    for(const value of [undefined,'plugins.shared.use','plugins.shared.call.*','plugins.shared.call.p.service.v0','plugins.shared.call.p.service.v10000']) expect(targetFromCapability(value)).toBeNull();
});
test('requests persist across reloads, deduplicate and never grant capabilities',()=>{
    const first=new PluginORM(file).requestSharedLogicAccess('consumer',target);
    expect(first).toMatchObject({state:'pending',created:true});
    const next=new PluginORM(file).requestSharedLogicAccess('consumer',target);
    expect(next.request.id).toBe(first.request.id);
    expect(new PluginORM(file).getPlugin('consumer').capabilities).toEqual([]);
    new PluginORM(file).dismissSharedLogicRequest('consumer',first.request.id);
    expect(new PluginORM(file).getPlugin('consumer').sharedLogicRequests).toEqual([]);
    expect(new PluginORM(file).getPlugin('consumer').capabilities).toEqual([]);
});
test('allows pending access to an absent provider without granting permissions',()=>{
    const orm=new PluginORM(file);
    expect(orm.requestSharedLogicAccess('consumer',{...target,providerId:'missing'})).toMatchObject({state:'pending'});
    expect(new PluginORM(file).getPlugin('consumer').capabilities).toEqual([]);
    expect(()=>orm.requestSharedLogicAccess('missing-consumer',target)).toThrow('Save or deploy');
});
test('rejects arbitrary fields, wildcards, stale decisions and too many requests',()=>{
    const orm=new PluginORM(file);
    expect(()=>orm.requestSharedLogicAccess('consumer',{...target,name:'*'})).toThrow();
    expect(()=>orm.requestSharedLogicAccess('consumer',{...target,capability:'ssh.exec'})).toThrow();
    expect(()=>orm.dismissSharedLogicRequest('consumer','stale')).toThrow('no longer pending');
    for(let version=1;version<=32;version++)new PluginORM(file).requestSharedLogicAccess('consumer',{...target,version});
    expect(()=>new PluginORM(file).requestSharedLogicAccess('consumer',{...target,version:33})).toThrow('Review existing');
});
test('failed atomic writes report failure without changing the registry or leaking temporary files',()=>{
    const original=fs.readFileSync(file,'utf8');
    jest.spyOn(fs,'renameSync').mockImplementation(()=>{throw new Error('disk full');});
    expect(()=>new PluginORM(file).requestSharedLogicAccess('consumer',target)).toThrow('disk full');
    expect(fs.readFileSync(file,'utf8')).toBe(original);
    expect(fs.readdirSync(home)).toEqual(['plugins.json']);
});

test('bindings survive reloads, stay consumer-scoped, and never grant access by themselves',()=>{
    const alias={...target,providerId:'example-id'};
    new PluginORM(file).setSharedLogicBinding('consumer',alias,target.providerId);
    const orm=new PluginORM(file);
    expect(orm.resolveSharedLogicTarget('consumer',alias)).toEqual(target);
    expect(orm.resolveSharedLogicTarget('another-consumer',alias)).toEqual(alias);
    expect(orm.getPlugin('consumer').capabilities).toEqual([]);
    expect(()=>orm.setSharedLogicBinding('consumer',alias,'not-installed')).toThrow('not installed');
    orm.setSharedLogicBinding('consumer',alias,alias.providerId);
    expect(new PluginORM(file).resolveSharedLogicTarget('consumer',alias)).toEqual(alias);
});

test('repairs the previously approved logical and installed IDs without changing grants',()=>{
    const alias={...target,providerId:'website-availability-provider'};
    const saved=JSON.parse(fs.readFileSync(file,'utf8'));
    saved.plugins[0].capabilities=['plugins.shared.use',capability(alias),capability(target)];
    saved.plugins[0].sharedLogicBindings=[];
    saved.plugins[1].capabilities=['plugins.shared.provide'];
    saved.plugins[1].sharedLogicExports=[{...target,methods:['check']}];
    fs.writeFileSync(file,JSON.stringify(saved));
    expect(new PluginORM(file).resolveSharedLogicTarget('consumer',alias)).toEqual(target);
    expect(new PluginORM(file).getPlugin('consumer').sharedLogicBindings).toEqual([{...alias,installedProviderId:target.providerId}]);
    expect(new PluginORM(file).getPlugin('consumer').capabilities).toEqual(saved.plugins[0].capabilities);
});

test.each(['missing-provider-grant','missing-logical-grant','missing-base','different-version','ambiguous','installed-target'])('does not infer a binding for %s',scenario=>{
    const alias={...target,providerId:'example-id'};
    const saved=JSON.parse(fs.readFileSync(file,'utf8'));
    saved.plugins[0].capabilities=['plugins.shared.use',capability(alias),capability(target)];
    saved.plugins[1].capabilities=['plugins.shared.provide'];
    saved.plugins[1].sharedLogicExports=[{...target,methods:['check']}];
    if(scenario==='missing-provider-grant')saved.plugins[0].capabilities.pop();
    if(scenario==='missing-logical-grant')saved.plugins[0].capabilities=saved.plugins[0].capabilities.filter(value=>value!==capability(alias));
    if(scenario==='different-version')saved.plugins[1].sharedLogicExports[0].version=2;
    if(scenario==='missing-base')saved.plugins[0].capabilities.shift();
    if(scenario==='installed-target')saved.plugins.push({id:alias.providerId,capabilities:[]});
    if(scenario==='ambiguous'){
        const other={...target,providerId:'another-provider'};
        saved.plugins[0].capabilities.push(capability(other));
        saved.plugins.push({id:other.providerId,capabilities:['plugins.shared.provide'],sharedLogicExports:[{...other,methods:['check']}]});
    }
    fs.writeFileSync(file,JSON.stringify(saved));
    expect(new PluginORM(file).resolveSharedLogicTarget('consumer',alias)).toEqual(alias);
    expect(JSON.parse(fs.readFileSync(file,'utf8'))).toEqual(saved);
});

test('repair is idempotent and preserves a deliberately chosen existing binding',()=>{
    const alias={...target,providerId:'example-id'};
    const saved=JSON.parse(fs.readFileSync(file,'utf8'));
    saved.plugins[0].capabilities=['plugins.shared.use',capability(alias),capability(target)];
    saved.plugins[0].sharedLogicBindings=[{...alias,installedProviderId:'previously-selected-provider'}];
    saved.plugins[1].capabilities=['plugins.shared.provide'];
    saved.plugins[1].sharedLogicExports=[{...target,methods:['check']}];
    fs.writeFileSync(file,JSON.stringify(saved));
    expect(new PluginORM(file).repairApprovedSharedLogicBindings()).toEqual([]);
    expect(new PluginORM(file).resolveSharedLogicTarget('consumer',alias).providerId).toBe('previously-selected-provider');
    expect(JSON.parse(fs.readFileSync(file,'utf8'))).toEqual(saved);
});
