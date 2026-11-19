'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {execFileSync} = require('node:child_process');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const requiredIds = ['missing-package-notices','publication-rights','cursor-redistribution','git-native-distribution','native-ai-notices','copied-artwork-and-builds'];
const targetName = ({platform,arch}) => `${platform === 'darwin' ? 'mac' : platform === 'win32' ? 'win' : platform}-${arch}`;
function sourceDigest(root) {
    // Hash working bytes, including untracked source, rather than trusting a commit label.
    const roots = ['src','docs','website','examples','packages','scripts','third_party','.github'];
    let names;
    try { names = execFileSync('git',['ls-files','--cached','--others','--exclude-standard','-z'],{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']}).split('\0').filter(Boolean); }
    catch {
        const walk = dir => fs.existsSync(dir) ? fs.readdirSync(dir,{withFileTypes:true}).flatMap(e => e.isSymbolicLink() ? [] : e.isDirectory() ? walk(path.join(dir,e.name)) : [path.relative(root,path.join(dir,e.name)).split(path.sep).join('/')]) : [];
        names = [...roots.flatMap(name=>walk(path.join(root,name))),...['package.json','package-lock.json','LICENSE'].filter(name=>fs.existsSync(path.join(root,name)))];
    }
    names = names.filter(name => name !== 'third_party/review.json' && (roots.some(base=>name.startsWith(base+'/')) || !name.includes('/'))).sort();
    return hash(names.map(name => {
        const file = path.join(root,name);
        if (!fs.existsSync(file)) return `${name}:deleted\n`;
        const stat = fs.lstatSync(file);
        return `${name}:${stat.isSymbolicLink() ? 'symlink:'+fs.readlinkSync(file) : stat.isFile() ? hash(fs.readFileSync(file)) : 'directory'}\n`;
    }).join(''));
}
function bindingFor(root,inventory,assets) {
    return hash(JSON.stringify({sourceSha256:sourceDigest(root),lockSha256:inventory.lockSha256,project:inventory.project,target:inventory.target,
        packages:inventory.packages.map(p=>({root:p.root,name:p.name,version:p.version,metadata:p.packageJsonSha256,notices:p.notices})),
        assets:assets.groups.map(g=>({id:g.id,sha256:g.actualTreeSha256})),nativeInputs:inventory.nativeInputs}));
}
function reviewItems(review,{requireIds=false}={}) {
    if (review.schemaVersion!==1 || !Array.isArray(review.items) || !review.items.length) throw new Error('Invalid licensing review ledger.');
    const seen=new Set();
    for (const item of review.items) {
        if (!item.id || seen.has(item.id) || !['pending','cleared'].includes(item.status) || !item.action) throw new Error('Invalid or duplicate licensing review item.');
        seen.add(item.id);
        if (item.status==='cleared' && (!item.reviewedBy?.trim() || !/^\d{4}-\d{2}-\d{2}/.test(item.reviewedAt || '') || !Number.isFinite(Date.parse(item.reviewedAt)) || !item.resolution?.trim() || !Array.isArray(item.evidence) || !item.evidence.length || item.evidence.some(e=>typeof e!=='string'||!e.trim()) || !item.inputs || !Object.keys(item.inputs).length || Object.values(item.inputs).some(d=>!/^[a-f0-9]{64}$/.test(d)))) throw new Error(`Clearance requires reviewer, valid date, resolution, evidence and target input hashes: ${item.id}`);
    }
    if (requireIds && requiredIds.some(id=>!seen.has(id))) throw new Error('Required licensing review item was removed. Record a resolution instead.');
    return review.items;
}
function unresolved(review,{target,inputSha256,requireIds=false}={}) {
    return reviewItems(review,{requireIds}).flatMap(item => item.status!=='cleared' ? [item] : target && item.inputs[target]!==inputSha256 ? [{...item,status:'pending',reason:`Clearance missing or stale for ${target}`}]: []);
}
function assertReady(status) {
    if (status?.releaseReady!==true || !Array.isArray(status.issues) || status.issues.length || !Array.isArray(status.coverageIssues) || status.coverageIssues.length || !Array.isArray(status.pending) || status.pending.length) throw new Error('Publication requires complete, current licensing clearance with no missing notices or pending reviews.');
}
module.exports={bindingFor,targetName,sourceDigest,unresolved,reviewItems,assertReady,requiredIds};
