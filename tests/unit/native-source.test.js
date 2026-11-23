/** @jest-environment node */
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const zlib=require('node:zlib');
const crypto=require('node:crypto');
const ns=require('../../scripts/release/native-source.cjs');
const hex=value=>crypto.createHash('sha256').update(value).digest('hex');
const commit='a'.repeat(40);
let root;
beforeEach(()=>{root=fs.mkdtempSync(path.join(os.tmpdir(),'fdo-native-source-test-'));});
afterEach(()=>fs.rmSync(root,{recursive:true,force:true}));

function paxTarball(sha,payload='x'){
    const data=Buffer.from(`52 comment=${sha}\n`),header=Buffer.alloc(512);
    header.write('pax_global_header');header.write(data.length.toString(8).padStart(11,'0')+'\0',124);header.write('g',156);
    return zlib.gzipSync(Buffer.concat([header,Buffer.concat([data,Buffer.alloc(512-data.length)]),Buffer.from(payload),Buffer.alloc(1024)]));
}
function policyFixture(fileBytes=Buffer.from('upstream source')){
    const policy={schemaVersion:1,binary:{provider:'desktop/dugite-native',release:'v9.9.9-1',commit:'1234567'.padEnd(40,'0')},licenseNote:'note',
        components:[{id:'git',name:'Git',version:'v9',license:'GPL-2.0-only',kind:'git',repo:'git/git',commit,tag:'v9'},
            {id:'lib',name:'lib',version:'1',kind:'file',url:'https://example.invalid/lib-1.src.tar.zst',sha256:hex(fileBytes),size:fileBytes.length,file:'lib-1.src.tar.zst'}],
        targets:{'mac-arm64':{dugite:'darwin-arm64',components:['git','lib']}}};
    const file=path.join(root,'policy.json');fs.writeFileSync(file,JSON.stringify(policy));return {policy,file};
}
const embedded={'darwin-arm64':{name:'dugite-native-v9.9.9-1234567-macOS-arm64.tar.gz',url:'https://github.com/desktop/dugite-native/releases/download/v9.9.9-1/x.tar.gz'}};
const fakeFetch=(routes)=>async url=>{
    const body=routes[url];
    return body===undefined?new Response('missing',{status:404}):new Response(body);
};

test('repository policy covers every release target and pins every non-git source',()=>{
    const policy=JSON.parse(fs.readFileSync(ns.POLICY,'utf8'));
    for(const platform of ['mac-arm64','mac-x64','linux-x64','win-x64']){
        const components=ns.selectComponents(policy,platform);
        expect(components.map(c=>c.id)).toEqual(expect.arrayContaining(['dugite-native','git-lfs',platform==='win-x64'?'git-for-windows':'git']));
        expect(components.map(c=>c.id)).not.toContain('git-credential-manager');
        for(const component of components) if(component.kind==='file') expect(component.url.startsWith('https://')).toBe(true);
    }
    expect(ns.selectComponents(policy,'win-x64').some(c=>c.id.startsWith('msys2-msys2-runtime'))).toBe(true);
    expect(ns.selectComponents(policy,'win-x64').find(c=>c.id==='git-for-windows').commit).toBe('3a9e66c3d66bb6509be99fe21c3205f024c04568');
});

test('bundled dugite release must be covered by the repository policy',()=>{
    const policy=JSON.parse(fs.readFileSync(ns.POLICY,'utf8'));
    for(const platform of ['mac-arm64','mac-x64','linux-x64','win-x64']) expect(()=>ns.assertBinaryMatches(policy,platform)).not.toThrow();
    const bumped={'darwin-arm64':{name:'dugite-native-v2.54.0-deadbee-macOS-arm64.tar.gz',url:'https://github.com/desktop/dugite-native/releases/download/v2.54.0-1/x'}};
    expect(()=>ns.assertBinaryMatches(policy,'mac-arm64',bumped)).toThrow('not covered');
});

test('builds a verifiable archive from pinned sources without network access',async()=>{
    const bytes=Buffer.from('upstream source'),{file}=policyFixture(bytes);
    const fetchImpl=fakeFetch({[`https://codeload.github.com/git/git/tar.gz/${commit}`]:paxTarball(commit),'https://example.invalid/lib-1.src.tar.zst':bytes});
    const destination=path.join(root,'out');
    const names=await ns.build({destination,version:'1.0.7',commit:'b'.repeat(40),platform:'mac-arm64',fetchImpl,policyFile:file,embedded});
    expect(names).toEqual(ns.nativeSourceNames('1.0.7','mac-arm64'));
    const meta=await ns.verifyNativeSource({archive:path.join(destination,names[0]),sidecar:path.join(destination,names[1]),version:'1.0.7',commit:'b'.repeat(40),platform:'mac-arm64',policyFile:file});
    expect(meta.components.map(c=>c.id)).toEqual(['git','lib']);
    expect(meta.components[1].sha256).toBe(hex(bytes));
});

test('retries HTTP and network failures with the existing bounded backoff',async()=>{
    const bytes=Buffer.from('upstream source'),{file}=policyFixture(bytes);
    const fetchImpl=jest.fn()
        .mockResolvedValueOnce(new Response('unavailable',{status:503}))
        .mockRejectedValueOnce(new Error('network unavailable'))
        .mockResolvedValueOnce(new Response(paxTarball(commit)))
        .mockResolvedValueOnce(new Response(bytes));
    const setTimeoutImpl=global.setTimeout;
    const delay=jest.spyOn(global,'setTimeout').mockImplementation((callback,_ms,...args)=>setTimeoutImpl(callback,0,...args));
    try {
        await ns.build({destination:path.join(root,'retried'),version:'1.0.7',commit:'b'.repeat(40),platform:'mac-arm64',fetchImpl,policyFile:file,embedded});
        expect(fetchImpl).toHaveBeenCalledTimes(4);
        expect(delay.mock.calls.slice(0,2).map(call=>call[1])).toEqual([1500,3000]);
        expect(fetchImpl.mock.calls.slice(0,3).every(([url])=>url===`https://codeload.github.com/git/git/tar.gz/${commit}`)).toBe(true);
    } finally { delay.mockRestore(); }
});

test('refuses tampered pinned sources and archives for the wrong commit',async()=>{
    const {file}=policyFixture();
    const options={destination:path.join(root,'a'),version:'1.0.7',commit:'b'.repeat(40),platform:'mac-arm64',policyFile:file,embedded};
    await expect(ns.build({...options,fetchImpl:fakeFetch({[`https://codeload.github.com/git/git/tar.gz/${commit}`]:paxTarball(commit),'https://example.invalid/lib-1.src.tar.zst':Buffer.from('tampered')})})).rejects.toThrow('Checksum mismatch');
    await expect(ns.build({...options,destination:path.join(root,'b'),fetchImpl:fakeFetch({[`https://codeload.github.com/git/git/tar.gz/${commit}`]:paxTarball('c'.repeat(40)),'https://example.invalid/lib-1.src.tar.zst':Buffer.from('upstream source')})})).rejects.toThrow('is not commit');
});

test('verification rejects records for another release or a changed policy',async()=>{
    const bytes=Buffer.from('upstream source'),{policy,file}=policyFixture(bytes);
    const source=path.join(root,'src');fs.mkdirSync(source);
    const fixture=require('../helpers/nativeSourceFixture.cjs');
    const [archive,sidecar]=await fixture({source,version:'1.0.7',commit:'b'.repeat(40),platform:'mac-arm64',policyFile:file});
    const args={archive:path.join(source,archive),sidecar:path.join(source,sidecar),version:'1.0.7',commit:'b'.repeat(40),platform:'mac-arm64',policyFile:file};
    await expect(ns.verifyNativeSource(args)).resolves.toBeTruthy();
    await expect(ns.verifyNativeSource({...args,commit:'c'.repeat(40)})).rejects.toThrow('Mismatched');
    policy.components[0].commit='d'.repeat(40);fs.writeFileSync(file,JSON.stringify(policy));
    await expect(ns.verifyNativeSource(args)).rejects.toThrow('policy');
});
