/** @jest-environment node */
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {verifyDistribution}=require('../../scripts/legal/distribution.cjs');
let root;
beforeEach(()=>{root=fs.mkdtempSync(path.join(os.tmpdir(),'fdo-exclusions-'));});
afterEach(()=>fs.rmSync(root,{recursive:true,force:true}));
const policy={schemaVersion:1,excluded:[{id:'cursor',packages:['@cursor/sdk'],paths:['node_modules/@cursor']}]};
test('removed components are rejected when compiled into bundles, left in ASAR, or left unpacked',async()=>{
    expect(()=>verifyDistribution({resources:root,policy,inventory:{packages:[{name:'@cursor/sdk'}]}})).toThrow('remains distributed');
    const input=path.join(root,'input'),packageDir=path.join(input,'node_modules/@cursor');fs.mkdirSync(packageDir,{recursive:true});fs.writeFileSync(path.join(packageDir,'runtime'),'binary');
    await require('@electron/asar').createPackage(input,path.join(root,'app.asar'));
    fs.rmSync(input,{recursive:true});
    expect(()=>verifyDistribution({resources:root,policy,inventory:{packages:[]}})).toThrow('remains distributed');
    fs.unlinkSync(path.join(root,'app.asar'));fs.mkdirSync(path.join(root,'app.asar.unpacked/node_modules/@cursor'),{recursive:true});
    expect(()=>verifyDistribution({resources:root,policy,inventory:{packages:[]}})).toThrow('remains distributed');
    fs.rmSync(path.join(root,'app.asar.unpacked'),{recursive:true});
    expect(verifyDistribution({resources:root,policy,inventory:{packages:[]}}).excluded).toEqual(['cursor']);
});
test('release policy rejects the external CLI and unpacked helpers', () => {
    const shipped = require('../../third_party/distribution-policy.json');
    expect(() => verifyDistribution({resources:root, policy:shipped, inventory:{packages:[{name:'@openai/codex-darwin-arm64'}]}})).toThrow('external-codex');
    fs.writeFileSync(path.join(root,'codex-code-mode-host.exe'),'fixture');
    expect(() => verifyDistribution({resources:root, policy:shipped, inventory:{packages:[]}})).toThrow('external-codex');
});
