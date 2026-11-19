'use strict';
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {evidenceNames}=require('./legal-evidence.cjs');
const {platforms,sha256}=require('./common.cjs');
const {assertReady,unresolved}=require('../legal/clearance.cjs');
async function verifyLegalArchive(file,{version,commit,platform,clearance,packagedTests,sbomSha256}) {
    const entries=new Map(), documents=new Map();
    let totalBytes=0;
    await new Promise((resolve,reject)=>require('yauzl').open(file,{lazyEntries:true},(error,zip)=>{
        if(error)return reject(error);
        const fail=error=>{zip.close();reject(error);};
        zip.on('error',fail);zip.on('end',resolve);
        zip.on('entry',entry=>{
            const name=entry.fileName;
            totalBytes+=entry.uncompressedSize;
            if(totalBytes>512*1024*1024 || entries.size>10000)return fail(new Error('Legal archive exceeds size limit.'));
            if(name.endsWith('/') || name.startsWith('/') || name.split('/').some(p=>p==='..'||!p) || name.includes('\\') || entries.has(name) || entry.uncompressedSize>100*1024*1024)return fail(new Error('Invalid legal archive entry.'));
            entries.set(name,null);
            zip.openReadStream(entry,(error,stream)=>{
                if(error)return fail(error);
                const hash=crypto.createHash('sha256'),chunks=[];
                const document=['files.json','review-status.json','review.json','inventory.json','packaged-tests.json'].includes(name);
                let size=0;
                stream.on('error',fail);stream.on('data',chunk=>{
                    size+=chunk.length;
                    if(size>100*1024*1024 || document && size>20*1024*1024){stream.destroy(new Error('Legal evidence exceeds size limit.'));return;}
                    hash.update(chunk);if(document)chunks.push(chunk);
                });
                stream.on('end',()=>{entries.set(name,hash.digest('hex'));if(document)documents.set(name,Buffer.concat(chunks).toString('utf8'));zip.readEntry();});
            });
        });zip.readEntry();
    }));
    const read=name=>{if(!documents.has(name))throw new Error(`Missing archived legal evidence: ${name}`);return JSON.parse(documents.get(name));};
    const index=read('files.json'),expected=new Set(['files.json']);
    for(const item of index.files){if(expected.has(item.path)||entries.get(item.path)!==item.sha256)throw new Error('Archived legal evidence checksum mismatch.');expected.add(item.path);}
    if(entries.size!==expected.size || [...entries.keys()].some(name=>!expected.has(name)))throw new Error('Incomplete archived legal inventory.');
    for(const name of ['THIRD_PARTY_NOTICES.txt','sbom.cdx.json','asset-inventory.json','LICENSES.chromium.html','inventory.json','review.json','review-status.json'])if(!entries.has(name))throw new Error(`Missing archived legal evidence: ${name}`);
    if(entries.get('sbom.cdx.json')!==sbomSha256)throw new Error('Archived SBOM differs from release sidecar.');
    const status=read('review-status.json'),inventory=read('inventory.json');
    assertReady(status);
    const tests=read('packaged-tests.json');
    require('./packaged-test-evidence.cjs').assertPackagedTests(tests,{version,commit,platform});
    if(JSON.stringify(tests)!==JSON.stringify(packagedTests))throw new Error('Packaged test evidence mismatch.');
    if(require('../legal/clearance.cjs').targetName(inventory.target)!==platform || status.source?.commit!==commit || status.source?.dirty!==false || inventory.project.version!==version || inventory.source.commit!==commit || inventory.source.dirty!==false || inventory.clearance?.target!==platform || JSON.stringify(inventory.clearance)!==JSON.stringify(clearance) || JSON.stringify(status.clearance)!==JSON.stringify(clearance) || unresolved(read('review.json'),{...clearance,requireIds:true}).length)throw new Error('Archived licensing clearance does not match release inputs.');
}
async function verifyPublicationEvidence(directory,{version,commit,manifest}) {
    if(!Array.isArray(manifest.builds) || manifest.builds.length!==Object.keys(platforms).length || new Set(manifest.builds.map(b=>b.platform)).size!==Object.keys(platforms).length)throw new Error('Publication requires evidence for every supported platform.');
    for(const platform of Object.keys(platforms)){
        const build=manifest.builds.find(b=>b.platform===platform),names=evidenceNames(version,platform);
        if(!build || names.some(name=>!build.evidence?.includes(name) || !fs.existsSync(path.join(directory,name))))throw new Error(`Missing publication evidence: ${platform}`);
        const nativeNames=require('./native-source.cjs').nativeSourceNames(version,platform);
        if(nativeNames.some(name=>!build.nativeSource?.includes(name) || !fs.existsSync(path.join(directory,name))))throw new Error(`Missing native source archive: ${platform}`);
        const provenance=JSON.parse(fs.readFileSync(path.join(directory,names[2]),'utf8'));
        if(provenance.legalReleaseReady!==true || provenance.version!==version || provenance.commit!==commit || provenance.platform!==platform || provenance.source?.commit!==commit || provenance.source?.dirty!==false || provenance.clearance?.target!==platform || !/^[a-f0-9]{64}$/.test(provenance.clearance.inputSha256))throw new Error(`Publication requires current licensing clearance: ${platform}`);
        if(await sha256(path.join(directory,names[0]))!==provenance.legalArchiveSha256 || await sha256(path.join(directory,names[1]))!==provenance.sbomSha256)throw new Error('Publication evidence checksum mismatch.');
        require('./packaged-test-evidence.cjs').assertPackagedTests(provenance.packagedTests,{version,commit,platform});
        for(const name of require('./common.cjs').assetNames(version,platform)) if(provenance.packagedTests.installers.find(file=>file.name===name)?.sha256!==await sha256(path.join(directory,name)))throw new Error('Published installer differs from packaged test evidence.');
        await verifyLegalArchive(path.join(directory,names[0]),{version,commit,platform,clearance:provenance.clearance,packagedTests:provenance.packagedTests,sbomSha256:provenance.sbomSha256});
    }
}
module.exports={verifyPublicationEvidence,verifyLegalArchive};
