'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {sha256,assetNames}=require('./common.cjs');
const requiredTests=['plugin worker excludes host secrets and denies unrelated files while loading its own assets','zero-grant plugin enforces builtin and filesystem permissions in its real worker','migrates legacy AI secrets to OS protection, redacts IPC and survives restart','packaged application includes verified notices and opens them offline'];
function testCases(report) {
    const visit=suite=>[...(suite.specs||[]).flatMap(spec=>(spec.tests||[]).map(test=>({title:spec.title,status:test.status,results:(test.results||[]).map(r=>r.status)}))),...(suite.suites||[]).flatMap(visit)];
    return (report.suites||[]).flatMap(visit);
}
async function applicationDigest(executable) {
    const resources=process.platform==='darwin'?path.resolve(executable,'../../Resources'):path.join(path.dirname(executable),'resources');
    const hash=require('node:crypto').createHash('sha256');
    const visit=async(file,name)=>{
        const stat=fs.lstatSync(file);hash.update(name+'\0');
        if(stat.isSymbolicLink()){hash.update('link:'+fs.readlinkSync(file));return;}
        if(stat.isDirectory()){for(const entry of fs.readdirSync(file).sort())await visit(path.join(file,entry),name+'/'+entry);}
        else hash.update(await sha256(file));
    };
    await visit(executable,'executable');
    await visit(resources,'resources');
    if(!fs.existsSync(path.join(resources,'app.asar')))throw new Error('Missing tested application archive.');
    return hash.digest('hex');
}
function assertPackagedTests(report,{version,commit,platform}) {
    if(!report || report.schemaVersion!==1 || report.version!==version || report.commit!==commit || report.platform!==platform || report.passed!==true || !Array.isArray(report.tests) || !report.tests.length || report.tests.some(t=>!['expected','skipped'].includes(t.status)) || requiredTests.some(title=>!report.tests.some(t=>t.title===title && t.status==='expected' && t.results?.length===1 && t.results[0]==='passed')) || !/^[a-f0-9]{64}$/.test(report.executableSha256 || '') || !/^[a-f0-9]{64}$/.test(report.applicationSha256 || '') || !Array.isArray(report.installers))throw new Error(`Missing or unsuccessful packaged security test evidence: ${platform}`);
}
async function recordTests({jsonFile,executable,root,version,commit,platform,passed}) {
    const raw=fs.readFileSync(jsonFile),report=JSON.parse(raw);
    const installers=[];
    for(const name of assetNames(version,platform)){const file=path.join(root,name);if(fs.existsSync(file))installers.push({name,sha256:await sha256(file)});}
    return {schemaVersion:1,version,commit,platform,passed:passed && !report.errors?.length,completedAt:new Date().toISOString(),workflow:process.env.GITHUB_WORKFLOW_REF||null,runId:process.env.GITHUB_RUN_ID||null,runAttempt:process.env.GITHUB_RUN_ATTEMPT||null,executableSha256:await sha256(executable),applicationSha256:await applicationDigest(executable),resultsSha256:require('node:crypto').createHash('sha256').update(raw).digest('hex'),installers,tests:testCases(report)};
}
module.exports={recordTests,assertPackagedTests,requiredTests,testCases,applicationDigest};
