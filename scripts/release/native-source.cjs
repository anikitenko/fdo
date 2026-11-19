'use strict';
// Builds the per-target corresponding-source archive for the native Git
// distribution (dugite-native) that ships inside the installers. It only
// produces extra release assets; it never changes the application or the
// installers themselves. See docs/NATIVE_SOURCE_DISTRIBUTION.md.
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const zlib=require('node:zlib');
const crypto=require('node:crypto');
const {Readable}=require('node:stream');
const {pipeline,finished}=require('node:stream/promises');
const {sha256:fileSha256}=require('./common.cjs');
const root=path.resolve(__dirname,'../..');
const POLICY=path.join(root,'third_party','native-source.json');
const DUGITE_KEY={'mac-arm64':'darwin-arm64','mac-x64':'darwin-x64','linux-x64':'linux-x64','win-x64':'win32-x64'};
const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const hex=value=>crypto.createHash('sha256').update(value).digest('hex');

function nativeSourceNames(version,platform) {
    const prefix=`fdo-${version}-${platform}-native-source`;
    return [`${prefix}.zip`,`${prefix}.json`];
}
function archiveFile(component) {
    return component.kind==='git' ? `${component.repo.replace('/','-')}-${component.commit}.tar.gz` : component.file;
}
function downloadUrl(component) {
    return component.kind==='git' ? `https://codeload.github.com/${component.repo}/tar.gz/${component.commit}` : component.url;
}
function selectComponents(policy,platform) {
    const target=policy.targets?.[platform];
    if (!target) throw new Error(`No native source policy for ${platform}.`);
    const byId=new Map(policy.components.map(component=>[component.id,component]));
    if (byId.size!==policy.components.length) throw new Error('Duplicate native source component id.');
    return target.components.map(id=>{
        const component=byId.get(id);
        if (!component) throw new Error(`Unknown native source component: ${id}`);
        if (component.kind==='git' && !/^[0-9a-f]{40}$/.test(component.commit)) throw new Error(`Invalid commit for ${id}.`);
        if (component.kind==='file' && (!/^[0-9a-f]{64}$/.test(component.sha256) || !/^https:\/\//.test(component.url) || !component.file)) throw new Error(`Native source file ${id} must be HTTPS and pinned by sha256.`);
        if (!['git','file'].includes(component.kind)) throw new Error(`Unsupported native source kind: ${id}`);
        return component;
    });
}
// The bundled binary must be the exact dugite-native release the policy covers.
function assertBinaryMatches(policy,platform,embedded=read(path.join(root,'node_modules','dugite','script','embedded-git.json'))) {
    const key=policy.targets?.[platform]?.dugite;
    if (!key || key!==DUGITE_KEY[platform]) throw new Error(`Native source policy target mismatch: ${platform}`);
    const entry=embedded[key];
    if (!entry || !entry.url.includes(`/${policy.binary.release}/`) || !entry.name.includes(`-${policy.binary.commit.slice(0,7)}-`)) {
        throw new Error(`Bundled Git (${entry?.name}) is not covered by third_party/native-source.json (${policy.binary.release}). Update the policy before releasing.`);
    }
    return entry;
}
function paxCommit(head) {
    const text=zlib.gunzipSync(head,{finishFlush:zlib.constants.Z_SYNC_FLUSH}).subarray(0,1024).toString('latin1');
    return /comment=([0-9a-f]{40})\n/.exec(text)?.[1];
}
async function fetchWithRetry(fetchImpl,url) {
    let failure;
    for (let attempt=1;attempt<=4;attempt++) {
        try {
            const response=await fetchImpl(url,{redirect:'follow'});
            if (response.ok) return response;
            failure=new Error(`HTTP ${response.status}`);
        } catch (error) {
            failure=error;
        }
        await new Promise(resolve=>setTimeout(resolve,attempt*1500));
    }
    throw new Error(`Unable to download ${url}: ${failure.message}`);
}
async function download(component,directory,fetchImpl) {
    const file=path.join(directory,archiveFile(component));
    const response=await fetchWithRetry(fetchImpl,downloadUrl(component));
    const hash=crypto.createHash('sha256');
    let size=0,head=Buffer.alloc(0);
    const output=fs.createWriteStream(file,{flags:'wx'});
    await pipeline(Readable.fromWeb(response.body),async function* (chunks) {
        for await (const chunk of chunks) {
            hash.update(chunk);size+=chunk.length;
            if (head.length<4096) head=Buffer.concat([head,chunk.subarray(0,4096-head.length)]);
            yield chunk;
        }
    },output);
    const sha256=hash.digest('hex');
    if (component.kind==='file') {
        if (sha256!==component.sha256) throw new Error(`Checksum mismatch for ${component.id}: expected ${component.sha256}, got ${sha256}`);
        if (component.size && size!==component.size) throw new Error(`Size mismatch for ${component.id}.`);
    } else if (paxCommit(head)!==component.commit) {
        throw new Error(`Downloaded archive for ${component.id} is not commit ${component.commit}.`);
    }
    return {file,size,sha256};
}
function readme({version,platform,policy,components}) {
    return [`FDO ${version} (${platform}) - corresponding source for bundled native Git components`,'',
        'The FDO installer bundles a Git distribution produced by desktop/dugite-native '+policy.binary.release+' (commit '+policy.binary.commit+').',
        'This archive contains the upstream source for that distribution, identified in the accompanying .json file by URL, commit and SHA-256.',
        'GitHub repositories are included as tarballs of the exact commit; MSYS2 packages are the .src.tar.zst files published by MSYS2.','',
        'Components:',...components.map(component=>`- ${component.name} ${component.version}${component.license?` (${component.license})`:''}: ${archiveFile(component)}${component.note?` - ${component.note}`:''}`),'',
        policy.licenseNote,'',
        'FDO itself is distributed under its own licence; see LICENSE and THIRD_PARTY_NOTICES.txt in the installer.',''].join('\n');
}
async function build({destination,version,commit,platform,fetchImpl=fetch,policyFile=POLICY,embedded}) {
    const policy=read(policyFile);
    assertBinaryMatches(policy,platform,embedded);
    const components=selectComponents(policy,platform);
    const [archiveName,sidecarName]=nativeSourceNames(version,platform);
    fs.mkdirSync(destination,{recursive:true});
    const work=fs.mkdtempSync(path.join(os.tmpdir(),'fdo-native-source-'));
    try {
        const records=[];
        for (const component of components) {
            const downloaded=await download(component,work,fetchImpl);
            records.push({component,...downloaded});
            console.log(`native-source: ${component.id} ${downloaded.size} bytes`);
        }
        const archive=new (require('archiver').ZipArchive)({store:true});
        const output=fs.createWriteStream(path.join(destination,archiveName),{flags:'wx'});
        const closed=finished(output);
        archive.on('error',error=>output.destroy(error));
        archive.on('warning',error=>output.destroy(error));
        archive.pipe(output);
        archive.append(readme({version,platform,policy,components}),{name:'README.txt'});
        for (const record of records) archive.file(record.file,{name:`sources/${archiveFile(record.component)}`});
        await Promise.all([archive.finalize(),closed]);
        const archivePath=path.join(destination,archiveName);
        const sidecar={schemaVersion:1,version,commit,platform,binary:policy.binary,policySha256:hex(fs.readFileSync(policyFile)),
            archive:archiveName,archiveSha256:await fileSha256(archivePath),
            components:records.map(({component,size,sha256})=>({id:component.id,name:component.name,version:component.version,license:component.license,
                source:component.kind==='git'?{repo:component.repo,commit:component.commit,tag:component.tag}:{url:component.url},file:archiveFile(component),size,sha256}))};
        fs.writeFileSync(path.join(destination,sidecarName),JSON.stringify(sidecar,null,2)+'\n',{flag:'wx'});
        return [archiveName,sidecarName];
    } finally {
        fs.rmSync(work,{recursive:true,force:true});
    }
}
function listZip(file) {
    return new Promise((resolve,reject)=>require('yauzl').open(file,{lazyEntries:true},(error,zip)=>{
        if (error) return reject(error);
        const entries=new Map();
        zip.on('error',reject);
        zip.on('end',()=>resolve(entries));
        zip.on('entry',entry=>{
            if (entries.has(entry.fileName) || entry.fileName.startsWith('/') || entry.fileName.includes('..') || entry.fileName.includes('\\')) {zip.close();return reject(new Error('Invalid native source archive entry.'));}
            entries.set(entry.fileName,entry.uncompressedSize);
            zip.readEntry();
        });
        zip.readEntry();
    }));
}
// Verifies a built (or downloaded) native-source pair against the repository policy.
async function verifyNativeSource({archive,sidecar,version,commit,platform,policyFile=POLICY}) {
    const policy=read(policyFile),meta=read(sidecar),components=selectComponents(policy,platform);
    const [archiveName]=nativeSourceNames(version,platform);
    if (meta.schemaVersion!==1 || meta.version!==version || meta.commit!==commit || meta.platform!==platform || meta.archive!==archiveName) throw new Error(`Mismatched native source record: ${platform}`);
    if (meta.policySha256!==hex(fs.readFileSync(policyFile)) || JSON.stringify(meta.binary)!==JSON.stringify(policy.binary)) throw new Error(`Native source record does not match the repository policy: ${platform}`);
    if (!Array.isArray(meta.components) || meta.components.length!==components.length) throw new Error(`Incomplete native source record: ${platform}`);
    const entries=await listZip(archive);
    const expected=new Set(['README.txt']);
    components.forEach((component,index)=>{
        const item=meta.components[index],name=`sources/${archiveFile(component)}`;
        if (item.id!==component.id || item.file!==archiveFile(component) || (component.kind==='file' && item.sha256!==component.sha256) || !/^[0-9a-f]{64}$/.test(item.sha256)) throw new Error(`Native source component mismatch: ${component.id}`);
        if (component.kind==='git' && item.source?.commit!==component.commit) throw new Error(`Native source commit mismatch: ${component.id}`);
        if (entries.get(name)!==item.size || !item.size) throw new Error(`Native source archive entry mismatch: ${component.id}`);
        expected.add(name);
    });
    if (entries.size!==expected.size || [...entries.keys()].some(name=>!expected.has(name))) throw new Error(`Unexpected native source archive contents: ${platform}`);
    if (await fileSha256(archive)!==meta.archiveSha256) throw new Error(`Native source archive checksum mismatch: ${platform}`);
    return meta;
}
module.exports={nativeSourceNames,build,verifyNativeSource,selectComponents,assertBinaryMatches,archiveFile,paxCommit,POLICY};
if (require.main===module) {
    const env=process.env;
    build({destination:'release',version:env.RELEASE_VERSION,commit:env.RELEASE_COMMIT,platform:`${env.RELEASE_PLATFORM}-${env.RELEASE_ARCH}`})
        .then(names=>console.log(`native-source: wrote ${names.join(', ')}`))
        .catch(error=>{console.error(error.message);process.exitCode=1;});
}
