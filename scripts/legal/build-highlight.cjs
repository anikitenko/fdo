'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const {sha256}=require('./inventory.cjs');
const recipe=require('../../third_party/highlight-build.json');
function build(archive){
    if(sha256(fs.readFileSync(archive))!==recipe.archiveSha256)throw new Error('Highlight source archive checksum mismatch.');
    const files=[recipe.base,...recipe.additionalLanguages.map(name=>{
        if(!/^[a-z0-9-]+$/.test(name))throw new Error('Invalid language name.');
        return `package/languages/${name}.min.js`;
    })];
    const chunks=files.map(name=>execFileSync('tar',['-xOf',path.resolve(archive),name],{maxBuffer:4*1024*1024}));
    const bytes=Buffer.concat(chunks.flatMap(chunk=>[chunk,Buffer.from('\n;\n')]));
    if(process.argv.includes('--check')){
        if(!bytes.equals(fs.readFileSync(recipe.output)))throw new Error('Highlight build does not match the recorded recipe.');
    }else fs.writeFileSync(recipe.output,bytes);
}
module.exports={build};
if(require.main===module){
    if(!process.argv[2]){
        console.error('Usage: node scripts/legal/build-highlight.cjs ARCHIVE [--check]');
        process.exitCode=1;
    }else{
        try{build(process.argv[2]);}
        catch(error){console.error(error.message);process.exitCode=1;}
    }
}
