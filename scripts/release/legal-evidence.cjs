'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {finished}=require('node:stream/promises');
const {walk,inside,sha256}=require('../legal/inventory.cjs');
const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
function evidenceNames(version,platform) {
    const prefix=`fdo-${version}-${platform}`;
    return [`${prefix}-legal.zip`,`${prefix}-sbom.cdx.json`,`${prefix}-provenance.json`];
}
function verifyLegalDirectory(directory,{version,commit,platform,publishing=false}) {
    const inventory=read(path.join(directory,'inventory.json')), status=read(path.join(directory,'review-status.json'));
    const target=`${inventory.target.platform==='darwin'?'mac':inventory.target.platform==='win32'?'win':inventory.target.platform}-${inventory.target.arch}`;
    if (inventory.project.version!==version || inventory.source.commit!==commit || target!==platform) throw new Error('Legal inventory does not match release source/target.');
    if (!Array.isArray(status.issues) || status.issues.length) throw new Error('Legal inventory has structural errors.');
    if (publishing && inventory.source.dirty!==false) throw new Error('Published releases require clean source provenance.');
    const manifest=read(path.join(directory,'files.json')), expected=new Set(['files.json']);
    for (const record of manifest.files) {
        const file=inside(directory,record.path);
        if (expected.has(record.path)) throw new Error('Duplicate legal evidence file.');
        expected.add(record.path);
        if (!fs.existsSync(file) || !fs.lstatSync(file).isFile() || sha256(fs.readFileSync(file))!==record.sha256) throw new Error(`Legal evidence checksum mismatch: ${record.path}`);
    }
    const actual=walk(directory).map(file=>path.relative(directory,file).split(path.sep).join('/'));
    if (actual.length!==expected.size || actual.some(name=>!expected.has(name))) throw new Error('Legal evidence inventory is incomplete.');
    for (const name of ['inventory.json','review-status.json','THIRD_PARTY_NOTICES.txt','sbom.cdx.json','asset-inventory.json','review.json','LICENSES.chromium.html']) if (!expected.has(name)) throw new Error(`Missing required legal evidence: ${name}`);
    return {inventory,status};
}
async function createLegalEvidence({directory,destination,version,commit,platform,signing,publishing=false}) {
    const {inventory,status}=verifyLegalDirectory(directory,{version,commit,platform,publishing});
    const [archiveName,bomName,provenanceName]=evidenceNames(version,platform);
    fs.mkdirSync(destination,{recursive:true});
    const archive=new (require('archiver').ZipArchive)({zlib:{level:9}});
    const output=fs.createWriteStream(path.join(destination,archiveName),{flags:'wx'});
    const closed=finished(output);
    archive.on('error',error=>output.destroy(error));
    archive.on('warning',error=>output.destroy(error));
    archive.pipe(output);
    for (const file of walk(directory)) archive.file(file,{name:path.relative(directory,file).split(path.sep).join('/')});
    await Promise.all([archive.finalize(),closed]);
    fs.copyFileSync(path.join(directory,'sbom.cdx.json'),path.join(destination,bomName),fs.constants.COPYFILE_EXCL);
    const provenance={schemaVersion:1,version,commit,platform,source:inventory.source,lockSha256:inventory.lockSha256,legalReleaseReady:status.releaseReady,
        signing,legalArchiveSha256:sha256(fs.readFileSync(path.join(destination,archiveName))),sbomSha256:sha256(fs.readFileSync(path.join(destination,bomName))),
        statement:'Build evidence record, not a signature or a legal opinion. Verify the GitHub attestation and final installer hashes separately. Native input hashes in the legal archive precede signing.',
        workflow:process.env.GITHUB_WORKFLOW_REF || null,runId:process.env.GITHUB_RUN_ID || null,runAttempt:process.env.GITHUB_RUN_ATTEMPT || null};
    fs.writeFileSync(path.join(destination,provenanceName),JSON.stringify(provenance,null,2)+'\n',{flag:'wx'});
    return evidenceNames(version,platform);
}
module.exports={evidenceNames,verifyLegalDirectory,createLegalEvidence};
