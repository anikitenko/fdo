'use strict';
const fs=require('node:fs');
const path=require('node:path');
function verifyDistribution({resources,policy,inventory}) {
    if(policy.schemaVersion!==1 || !Array.isArray(policy.excluded))throw new Error('Invalid distribution exclusion policy.');
    const asar=path.join(resources,'app.asar');
    const names=fs.existsSync(asar)?require('@electron/asar').listPackage(asar).map(name=>'app/'+name.replace(/\\/g,'/').replace(/^\//,'')):[];
    const walk=dir=>{for(const e of fs.readdirSync(dir,{withFileTypes:true})){
        if(e.name==='legal')continue;
        const file=path.join(dir,e.name),name=path.relative(resources,file).split(path.sep).join('/');
        names.push(name);if(e.isDirectory()&&!e.isSymbolicLink())walk(file);
    }};walk(resources);
    for(const item of policy.excluded){
        if(!item.id || !Array.isArray(item.packages) || !Array.isArray(item.paths) || !item.paths.length || item.packages.some(p=>typeof p!=='string'||!p) || item.paths.some(p=>typeof p!=='string'||!p||p.startsWith('/')||p.includes('..')))throw new Error('Exclusions require a component id, optional package prefixes and relative path fragments.');
        const packaged=!item.packages.length?undefined:(inventory.packages||[]).find(p=>item.packages.some(prefix=>p.name===prefix || p.name.startsWith(prefix+'-')));
        const file=names.find(name=>item.paths.some(fragment=>('/'+name+'/').includes('/'+fragment.replace(/\/$/,'')+'/')));
        if(packaged||file)throw new Error(`Excluded component remains distributed: ${item.id} (${packaged?.name||file})`);
    }
    return {excluded:policy.excluded.map(item=>item.id),checkedPaths:names.length};
}
module.exports={verifyDistribution};
