const fs = require('node:fs');
const path = require('node:path');
const {execFile} = require('node:child_process');
const {promisify} = require('node:util');
function binaryTarget(filename) {
    if (!fs.existsSync(filename)) return null;
    const fd=fs.openSync(filename,'r'), head=Buffer.alloc(4096); let size;
    try {size=fs.readSync(fd,head,0,head.length,0);} finally {fs.closeSync(fd);}
    if (size<20) return null;
    if (head.subarray(0,4).equals(Buffer.from([127,69,76,70]))) return {platform:'linux',arch:head.readUInt16LE(18)===183?'arm64':head.readUInt16LE(18)===62?'x64':null};
    if (head.readUInt32LE(0)===0xfeedfacf) return {platform:'darwin',arch:head.readUInt32LE(4)===0x100000c?'arm64':head.readUInt32LE(4)===0x1000007?'x64':null};
    if (head[0]===77 && head[1]===90) {const pe=head.readUInt32LE(60); if(pe+6<size) return {platform:'win32',arch:head.readUInt16LE(pe+4)===0xaa64?'arm64':head.readUInt16LE(pe+4)===0x8664?'x64':null};}
    return null;
}
async function stageOne(context) {
    const {Arch}=require('electron-builder');
    const platform=context.electronPlatformName, arch=typeof context.arch==='string'?context.arch:Arch[context.arch];
    if (!['linux','darwin','win32'].includes(platform)||!['x64','arm64'].includes(arch)) throw new Error(`Unsupported bundled Git target ${platform}/${arch}. Build separate x64/arm64 packages on their target OS.`);
    const destination=path.join(context.appDir,'dist/main/git-'+arch), relative=platform==='win32'?'cmd/git.exe':'bin/git';
    const lfs=platform==='win32'?(arch==='arm64'?'clangarm64':'mingw64')+'/libexec/git-core/git-lfs.exe':'libexec/git-core/git-lfs';
    const matches=directory => [relative,lfs].every(file=>{const target=binaryTarget(path.join(directory,file));return target?.platform===platform&&target?.arch===arch;});
    if (matches(destination)) return;
    const distribution=path.join(context.appDir,'node_modules/dugite/git');
    if (!matches(distribution)) {
        if (platform!==process.platform) throw new Error('Build the bundled Git distribution on the target operating system.');
        // Dugite verifies the pinned archive SHA-256 before extracting it.
        await promisify(execFile)(process.execPath,[path.join(context.appDir,'node_modules/dugite/script/download-git.js')],{env:{...process.env,npm_config_arch:arch},timeout:180000,maxBuffer:1024*1024});
    }
    if (!matches(distribution)) throw new Error(`Bundled Git for ${platform}/${arch} is missing or has the wrong architecture.`);
    fs.rmSync(destination,{recursive:true,force:true}); fs.cpSync(distribution,destination,{recursive:true});
}
let pending=Promise.resolve();
function stage(context){const result=pending.then(()=>stageOne(context));pending=result.catch(()=>{});return result;}
module.exports={stage,binaryTarget};
