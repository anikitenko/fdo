/** @jest-environment node */
import {createOfficialRegistry} from '../../src/utils/system/officialRegistry';
const {certificateFixture} = require('../helpers/certificateFixture.cjs');
const {X509Certificate} = require('node:crypto');
jest.mock('../../src/utils/persistence/certificateStorage',()=>({certificateStorage:{}}));
let root, config, storage, fetchCertificate;
beforeAll(async()=>{root=await certificateFixture();});
beforeEach(()=>{
    config={certificateUrl:'https://registry.example.test/root.pem',rootFingerprint256:new X509Certificate(root.cert).fingerprint256};
    const entries=[];
    storage={list:jest.fn(()=>entries),put:jest.fn(entry=>entries.push(entry))};
    fetchCertificate=jest.fn(async()=>new Response(root.cert));
});
test('obtains the one official certificate automatically, verifies the bundled pin and caches it',async()=>{
    const registry=createOfficialRegistry({config,storage,fetchCertificate});
    const [first,second]=await Promise.all([registry.ensureAnchor(),registry.ensureAnchor()]);
    expect(first.id).toBe(config.rootFingerprint256);expect(second).toEqual(first);
    expect(first).toMatchObject({kind:'anchor',official:true,label:'FDO Plugin Registry'});
    expect(storage.put).toHaveBeenCalledTimes(1);
    expect(fetchCertificate).toHaveBeenCalledWith(config.certificateUrl,expect.objectContaining({redirect:'error'}));
    await registry.ensureAnchor();expect(fetchCertificate).toHaveBeenCalledTimes(1);
});
test('rejects a certificate that does not match the FDO release pin',async()=>{
    config.rootFingerprint256='00'.repeat(32);
    await expect(createOfficialRegistry({config,storage,fetchCertificate}).ensureAnchor()).rejects.toThrow(/fingerprint/);
    expect(storage.put).not.toHaveBeenCalled();
});
test('unconfigured releases stay unavailable and do not contact an invented registry',async()=>{
    const registry=createOfficialRegistry({config:{},storage,fetchCertificate});
    expect(registry.configured()).toBe(false);
    await expect(registry.ensureAnchor()).rejects.toThrow(/not available yet/);
    expect(fetchCertificate).not.toHaveBeenCalled();
});
test('rejects insecure URLs and oversized downloads',async()=>{
    config.certificateUrl='http://registry.example.test/root.pem';
    await expect(createOfficialRegistry({config,storage,fetchCertificate}).ensureAnchor()).rejects.toThrow(/HTTPS/);
    config.certificateUrl='https://registry.example.test/root.pem';
    fetchCertificate.mockResolvedValue(new Response('x'.repeat(128*1024+1)));
    await expect(createOfficialRegistry({config,storage,fetchCertificate}).ensureAnchor()).rejects.toThrow(/too large/);
    expect(storage.put).not.toHaveBeenCalled();
});
test('loads the release display name from the official catalog independently of trust',async()=>{
    fetchCertificate.mockResolvedValue(new Response(JSON.stringify({plugin:{id:'owned-plugin',name:'Current name'},releases:[{version:'1.0.0',manifest:{name:'Original display name'}}]})));
    const registry=createOfficialRegistry({config,storage,fetchCertificate});
    expect(await registry.releaseDisplayName('owned-plugin','1.0.0')).toBe('Original display name');
    expect(fetchCertificate).toHaveBeenCalledWith('https://registry.example.test/api/v1/plugins/owned-plugin?version=1.0.0&limit=1',expect.objectContaining({redirect:'error'}));
    expect(storage.put).not.toHaveBeenCalled();
});
