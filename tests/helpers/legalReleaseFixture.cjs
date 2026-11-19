const fs=require('node:fs');
const path=require('node:path');
const {sha256,assetNames}=require('../../scripts/release/common.cjs');
const {requiredIds}=require('../../scripts/legal/clearance.cjs');
const {requiredTests}=require('../../scripts/release/packaged-test-evidence.cjs');
module.exports=async function fixture({root,source,platform,version,commit}){
    const directory=path.join(root,'legal-'+platform);fs.mkdirSync(directory,{recursive:true});
    const clearance={target:platform,inputSha256:'c'.repeat(64)},sourceContext={commit,dirty:false};
    const files={
        'inventory.json':{project:{version},source:sourceContext,target:{platform:platform.startsWith('mac-')?'darwin':platform.startsWith('win-')?'win32':'linux',arch:platform.split('-')[1]},clearance},
        'review-status.json':{releaseReady:true,issues:[],coverageIssues:[],pending:[],clearance,source:sourceContext},
        'review.json':{schemaVersion:1,items:requiredIds.map(id=>({id,status:'cleared',action:'Review',reviewedBy:'Fixture',reviewedAt:'2026-11-19',resolution:'Fixture only',evidence:['test:fixture'],inputs:{[platform]:clearance.inputSha256}}))},
        'THIRD_PARTY_NOTICES.txt':'fixture notices','sbom.cdx.json':{},'asset-inventory.json':{},'LICENSES.chromium.html':'fixture Chromium notices',
    };
    const records=[];
    for(const [name,value] of Object.entries(files)){const file=path.join(directory,name);fs.writeFileSync(file,typeof value==='string'?value:JSON.stringify(value));records.push({path:name,sha256:await sha256(file)});}
    fs.writeFileSync(path.join(directory,'files.json'),JSON.stringify({files:records}));
    const installers=await Promise.all(assetNames(version,platform).map(async name=>({name,sha256:await sha256(path.join(source,name))})));
    fs.writeFileSync(path.join(source,'packaged-security-report.json'),JSON.stringify({schemaVersion:1,version,commit,platform,passed:true,executableSha256:'d'.repeat(64),applicationSha256:'e'.repeat(64),installers,tests:requiredTests.map(title=>({title,status:'expected',results:['passed']}))}));
    return directory;
};
