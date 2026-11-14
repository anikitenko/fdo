/** @jest-environment node */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRegistryInstallStore} from '../../src/utils/plugins/importing/registryInstallStore';
let directory,store;
beforeEach(()=>{directory=fs.mkdtempSync(path.join(os.tmpdir(),'registry-store-'));store=createRegistryInstallStore(path.join(directory,'plugins.json'));});
afterEach(()=>{jest.restoreAllMocks();fs.rmSync(directory,{recursive:true,force:true});});
test('atomic commits survive a fresh instance and preserve unrelated plugins',()=>{
    store.commit('one',null,{id:'one',home:'old',registry:{version:'1.0.0'}});store.commit('two',null,{id:'two'});
    const previous=store.get('one');store.commit('one',previous,{...previous,home:'new'});
    expect(createRegistryInstallStore(store.file).all()).toEqual([{id:'two'},{...previous,home:'new'}]);
});
test('stale writes cannot discard concurrent grant changes',()=>{
    store.commit('one',null,{id:'one',capabilities:[]});const stale=store.get('one');store.commit('one',stale,{...stale,capabilities:['storage']});
    expect(()=>store.commit('one',stale,{...stale,home:'new'})).toThrow('changed while');expect(store.get('one').capabilities).toEqual(['storage']);
});
test('failed atomic rename retains old registry and removes temporary files',()=>{
    store.commit('one',null,{id:'one',home:'old'});
    jest.spyOn(fs,'renameSync').mockImplementation(()=>{throw Object.assign(new Error('Disk failure'),{code:'EIO'});});
    expect(()=>store.commit('one',store.get('one'),{id:'one',home:'new'})).toThrow('Disk failure');
    expect(store.get('one').home).toBe('old');expect(fs.readdirSync(directory)).toEqual(['plugins.json']);
});
test('corrupt registry is not replaced with an empty store',()=>{
    fs.writeFileSync(store.file,'corrupt');expect(()=>store.commit('one',null,{id:'one'})).toThrow();expect(fs.readFileSync(store.file,'utf8')).toBe('corrupt');
});
