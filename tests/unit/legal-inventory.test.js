/** @jest-environment node */
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const {generate,checkAssets,checkReview,sha256}=require('../../scripts/legal/inventory.cjs');
const {packageForResource}=require('../../scripts/legal/webpack-inventory.cjs');
const {verifyLegalDirectory,createLegalEvidence,evidenceNames}=require('../../scripts/release/legal-evidence.cjs');
let root;
const write=(name,value)=>{const file=path.join(root,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,typeof value==='string'?value:JSON.stringify(value));};
beforeEach(()=>{
    root=fs.mkdtempSync(path.join(os.tmpdir(),'fdo-legal-'));
    write('package.json',{name:'fixture',version:'1.0.0',license:'MIT'});
    write('package-lock.json',{packages:{'node_modules/fixture':{version:'1.0.0',dev:true}}});
    write('LICENSE','Project MIT notice');
    write('third_party/assets.json',{groups:[{id:'assets',name:'Fixture assets',version:'1',license:'MIT',files:['src/assets/test.txt'],treeSha256:sha256('src/assets/test.txt:'+sha256('asset')+'\n'),licenseFiles:[]}],licenseSha256:{}});
    write('src/assets/test.txt','asset');
    write('third_party/source-evidence.json',[]);write('third_party/recovered-notices.json',[]);
    write('third_party/review.json',{schemaVersion:1,items:[{id:'rights',status:'pending',action:'Obtain rights statement',evidence:[]}]});
    write('node_modules/fixture/package.json',{name:'fixture',version:'1.0.0',license:'MIT'});write('node_modules/fixture/LICENSE','Fixture original notice');
    write('node_modules/electron/package.json',{name:'electron',version:'1.0.0',license:'MIT'});write('node_modules/electron/LICENSE','Electron notice');write('node_modules/electron/dist/LICENSES.chromium.html','Chromium notices');
    const info=packageForResource(path.join(root,'node_modules/fixture/index.js'),root);
    for(const [name,base] of [['main','main'],['preload','main'],['renderer','renderer']])write(`dist/${base}/legal-inputs/${name}.json`,{schemaVersion:1,compiler:name,packages:name==='renderer'?[info]:[]});
    write('dist/main/export-runtime/dependencies.json',{packages:[info]});
    fs.mkdirSync(path.join(root,'dist/main/git-arm64'),{recursive:true});
});
afterEach(()=>fs.rmSync(root,{recursive:true,force:true}));
test('Windows-style Git checkout preserves reviewed asset and license bytes',()=>{
    write('.gitattributes',fs.readFileSync(path.resolve('.gitattributes'),'utf8'));
    const samples={
        'src/assets/line-endings.svg':Buffer.from('<svg>\nunchanged\n</svg>\n'),
        'src/assets/upstream-crlf.js':Buffer.from('// upstream\r\nunchanged\r\n'),
        'website/assets/example.svg':Buffer.from('<svg>\nwebsite\n</svg>\n'),
        'third_party/licenses/NOTICE':Buffer.from('Copyright fixture\nPermission notice\n'),
    };
    for (const [name,bytes] of Object.entries(samples)) {fs.mkdirSync(path.dirname(path.join(root,name)),{recursive:true});fs.writeFileSync(path.join(root,name),bytes);}
    write('ordinary.txt','line one\nline two\n');
    const git=(args,autocrlf='false')=>execFileSync('git',['-c',`core.autocrlf=${autocrlf}`,'-c','core.safecrlf=false',...args],{cwd:root,stdio:['ignore','pipe','pipe']});
    git(['init']);git(['add','.gitattributes','ordinary.txt',...Object.keys(samples)]);
    git(['checkout-index','--all','--prefix=checkout/'],'true');
    for (const [name,bytes] of Object.entries(samples)) expect(fs.readFileSync(path.join(root,'checkout',name))).toEqual(bytes);
    // Confirm the checkout really exercises CRLF conversion for ordinary text.
    expect(fs.readFileSync(path.join(root,'checkout/ordinary.txt'),'utf8')).toBe('line one\r\nline two\r\n');
});
test('captures bundled dev dependencies, original notices and explicit native coverage limits',()=>{
    const {inventory,status}=generate({root,platform:'darwin',arch:'arm64'});
    expect(inventory.packages.find(p=>p.name==='fixture').inclusions).toEqual(['compiled:export-runtime','compiled:renderer']);
    expect(inventory.productionDependencyGraph).toEqual([]);
    expect(fs.readFileSync(path.join(root,'dist/legal/THIRD_PARTY_NOTICES.txt'),'utf8')).toContain('Fixture original notice');
    expect(status.releaseReady).toBe(false);expect(status.pending).toHaveLength(1);
    expect(inventory.nativeInputs.hashScope).toContain('BEFORE');
    expect(()=>generate({root,platform:'darwin',arch:'arm64',release:true})).toThrow('rights');
});
test('rejects changed or unregistered assets and notice tampering',()=>{
    write('src/assets/test.txt','changed');expect(checkAssets(root).issues.join()).toContain('Asset contents changed');
    write('src/assets/new.svg','new');expect(checkAssets(root).issues.join()).toContain('Unregistered asset');
    write('third_party/assets.json',{groups:[],licenseSha256:{'LICENSE.txt':sha256('original')}});
    write('third_party/licenses/LICENSE.txt','tampered');expect(checkAssets(root).issues.join()).toContain('License text missing or changed');
});
test('rejects stale module metadata and never attributes outside-root sources',()=>{
    write('node_modules/fixture/package.json',{name:'fixture',version:'2.0.0',license:'MIT'});
    expect(()=>generate({root,platform:'darwin',arch:'arm64'})).toThrow('inventory is stale');
    expect(packageForResource('/tmp/outside/node_modules/fixture/index.js',root)).toBeNull();
});
test('missing original license text is reported and blocks clearance; it does not break review builds',()=>{
    fs.unlinkSync(path.join(root,'node_modules/fixture/LICENSE'));
    const {status}=generate({root,platform:'darwin',arch:'arm64'});
    expect(status.coverageIssues.join()).toContain('fixture@1.0.0');expect(status.releaseReady).toBe(false);
    expect(()=>generate({root,platform:'darwin',arch:'arm64',release:true})).toThrow('No original license');
});
test('clearance cannot be asserted without reviewer, resolution and evidence',()=>{
    write('third_party/review.json',{schemaVersion:1,items:[{id:'rights',status:'cleared',action:'Review',evidence:[]}]});
    expect(()=>checkReview(root)).toThrow('Clearance requires');
});
test('legal evidence checks source/target, validates every file and refuses pending publication',async()=>{
    generate({root,platform:'darwin',arch:'arm64'});
    const directory=path.join(root,'dist/legal'),options={version:'1.0.0',commit:null,platform:'mac-arm64'};
    expect(()=>verifyLegalDirectory(directory,{...options,platform:'linux-x64'})).toThrow('source/target');
    expect(()=>verifyLegalDirectory(directory,{...options,publishing:true})).toThrow('clearance is incomplete');
    const names=await createLegalEvidence({directory,destination:path.join(root,'release'),...options,signing:{signed:false,notarized:false}});
    expect(names).toEqual(evidenceNames('1.0.0','mac-arm64'));
    const provenance=JSON.parse(fs.readFileSync(path.join(root,'release',names[2]),'utf8'));
    expect(provenance.legalArchiveSha256).toBe(sha256(fs.readFileSync(path.join(root,'release',names[0]))));
    fs.appendFileSync(path.join(directory,'THIRD_PARTY_NOTICES.txt'),'tampered');
    expect(()=>verifyLegalDirectory(directory,options)).toThrow('checksum mismatch');
});
