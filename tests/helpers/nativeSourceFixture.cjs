const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {finished}=require('node:stream/promises');
const {ZipArchive}=require('archiver');
const ns=require('../../scripts/release/native-source.cjs');
const hex=value=>crypto.createHash('sha256').update(value).digest('hex');
// Writes a small archive that satisfies verifyNativeSource for the repository policy.
module.exports=async function nativeSourceFixture({source,version,commit,platform,policyFile=ns.POLICY}){
    const policy=JSON.parse(fs.readFileSync(policyFile,'utf8')),components=ns.selectComponents(policy,platform);
    const [archiveName,sidecarName]=ns.nativeSourceNames(version,platform);
    const archive=new ZipArchive({store:true}),output=fs.createWriteStream(path.join(source,archiveName)),closed=finished(output);
    archive.pipe(output);archive.append('fixture readme',{name:'README.txt'});
    const records=components.map(component=>{
        const bytes=`fixture ${component.id}`;archive.append(bytes,{name:`sources/${ns.archiveFile(component)}`});
        return {id:component.id,file:ns.archiveFile(component),size:bytes.length,sha256:component.kind==='file'?component.sha256:hex(bytes),
            source:component.kind==='git'?{repo:component.repo,commit:component.commit}:{url:component.url}};
    });
    await Promise.all([archive.finalize(),closed]);
    fs.writeFileSync(path.join(source,sidecarName),JSON.stringify({schemaVersion:1,version,commit,platform,binary:policy.binary,
        policySha256:hex(fs.readFileSync(policyFile)),archive:archiveName,archiveSha256:hex(fs.readFileSync(path.join(source,archiveName))),components:records}));
    return [archiveName,sidecarName];
};
