/** @jest-environment node */
const {assertPackagedTests,requiredTests,testCases}=require('../../scripts/release/packaged-test-evidence.cjs');
const expected={version:'1.0.7',commit:'a'.repeat(40),platform:'mac-arm64'};
const report=()=>({schemaVersion:1,...expected,passed:true,executableSha256:'b'.repeat(64),applicationSha256:'c'.repeat(64),installers:[],tests:requiredTests.map(title=>({title,status:'expected',results:['passed']}))});
test('critical packaged tests must run and pass once, against the release identity',()=>{
    expect(()=>assertPackagedTests(report(),expected)).not.toThrow();
    for(const mutate of [r=>r.tests.pop(),r=>r.tests[0].status='skipped',r=>r.tests[0].results=['failed','passed'],r=>r.commit='stale',r=>r.passed=false]){
        const r=report();mutate(r);expect(()=>assertPackagedTests(r,expected)).toThrow('packaged security test evidence');
    }
});
test('nested Playwright cases retain actual execution outcomes',()=>{
    expect(testCases({suites:[{suites:[{specs:[{title:'probe',tests:[{status:'unexpected',results:[{status:'failed'}]}]}]}]}]})).toEqual([{title:'probe',status:'unexpected',results:['failed']}]);
});

test('application digest changes when packaged native resources or application code change',async()=>{
    const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
    const root=fs.mkdtempSync(path.join(os.tmpdir(),'fdo-tested-content-'));
    try{
        const executable=process.platform==='darwin'?path.join(root,'App.app/Contents/MacOS/App'):path.join(root,'App.exe');
        const resources=process.platform==='darwin'?path.join(root,'App.app/Contents/Resources'):path.join(root,'resources');
        fs.mkdirSync(path.dirname(executable),{recursive:true});fs.writeFileSync(executable,'runtime');
        fs.mkdirSync(path.join(resources,'git'),{recursive:true});fs.writeFileSync(path.join(resources,'app.asar'),'original app');fs.writeFileSync(path.join(resources,'git/git'),'native tool');
        const {applicationDigest}=require('../../scripts/release/packaged-test-evidence.cjs'),before=await applicationDigest(executable);
        fs.writeFileSync(path.join(resources,'git/git'),'changed tool');expect(await applicationDigest(executable)).not.toBe(before);
        fs.writeFileSync(path.join(resources,'git/git'),'native tool');expect(await applicationDigest(executable)).toBe(before);
        fs.writeFileSync(path.join(resources,'app.asar'),'changed code');expect(await applicationDigest(executable)).not.toBe(before);
    }finally{fs.rmSync(root,{recursive:true,force:true});}
});
