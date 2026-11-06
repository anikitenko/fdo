'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {execFileSync} = require('node:child_process');
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const portable = name => name.split(path.sep).join('/');
const json = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const writeJson = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
function inside(root, name) {
    const result = path.resolve(root, name), relative = path.relative(root, result);
    if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) throw new Error(`Path outside project: ${name}`);
    return result;
}
// Never follow symlinked directories while collecting package notices or staged inputs.
function walk(directory) {
    if (!fs.existsSync(directory)) return [];
    return fs.readdirSync(directory, {withFileTypes: true}).sort((a,b)=>a.name.localeCompare(b.name)).flatMap(entry => {
        const file = path.join(directory, entry.name);
        if (entry.isSymbolicLink()) return [];
        return entry.isDirectory() ? walk(file) : entry.isFile() ? [file] : [];
    });
}
function checkReview(root) {
    const review = json(path.join(root, 'third_party/review.json'));
    if (review.schemaVersion !== 1 || !Array.isArray(review.items)) throw new Error('Invalid licensing review ledger.');
    for (const item of review.items) {
        if (!['pending','cleared'].includes(item.status) || !item.id || !item.action) throw new Error('Invalid licensing review item.');
        if (item.status === 'cleared' && (!item.reviewedBy || !item.reviewedAt || !item.resolution || !item.evidence?.length)) throw new Error(`Clearance requires reviewer, date, resolution and evidence: ${item.id}`);
    }
    return review.items.filter(item => item.status !== 'cleared');
}
function checkAssets(root) {
    const registry = json(path.join(root, 'third_party/assets.json')), issues = [], seen = new Set(), groups = [];
    for (const group of registry.groups) {
        const files = [];
        for (const name of [...group.files].sort()) {
            if (seen.has(name)) throw new Error(`Duplicate asset registration: ${name}`);
            seen.add(name);
            const file = inside(root, name);
            if (!fs.existsSync(file) || !fs.lstatSync(file).isFile()) {issues.push(`Missing asset: ${name}`);continue;}
            files.push({path:name,sha256:sha256(fs.readFileSync(file))});
        }
        const treeSha256 = sha256(files.map(file => `${file.path}:${file.sha256}\n`).join(''));
        if (treeSha256 !== group.treeSha256) issues.push(`Asset contents changed; review provenance and update the registered digest: ${group.id}`);
        for (const name of group.licenseFiles) if (!registry.licenseSha256[name]) issues.push(`Unregistered license text: ${name}`);
        groups.push({...group,files,actualTreeSha256:treeSha256});
    }
    for (const base of ['src/assets','website/assets']) for (const file of walk(path.join(root, base))) {
        const name = portable(path.relative(root,file));
        if (path.basename(file) !== '.DS_Store' && !seen.has(name)) issues.push(`Unregistered asset: ${name}`);
    }
    for (const [name, hash] of Object.entries(registry.licenseSha256)) {
        const file = inside(path.join(root,'third_party/licenses'),name);
        if (!fs.existsSync(file) || sha256(fs.readFileSync(file)) !== hash) issues.push(`License text missing or changed: ${name}`);
    }
    return {groups,issues};
}
function licenseFiles(directory) {
    const result = [];
    for (const entry of fs.readdirSync(directory,{withFileTypes:true})) {
        if (entry.isSymbolicLink()) continue;
        if (entry.isFile() && /^(licen[cs]e|copying|notice|copyright|authors)([._-].*)?$/i.test(entry.name)) result.push(path.join(directory,entry.name));
        if (entry.isDirectory() && /^(licen[cs]es|notices)$/i.test(entry.name)) result.push(...walk(path.join(directory,entry.name)));
    }
    return result.sort();
}
function sourceContext(root) {
    try {
        const git = args => execFileSync('git',args,{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
        // Include new/untracked source files; ignored build output is not source cleanliness evidence.
        return {commit:git(['rev-parse','HEAD']),dirty:!!git(['status','--porcelain','--untracked-files=normal'])};
    } catch {return {commit:null,dirty:null};}
}
function generate({root=process.cwd(), platform=process.platform, arch=process.arch, output=path.join(root,'dist/legal'), release=false, electronNoticesPath}={}) {
    root = path.resolve(root);output = path.resolve(output);
    const metadata = json(path.join(root,'package.json')), lock = json(path.join(root,'package-lock.json'));
    const assets = checkAssets(root), pending = checkReview(root), issues = [...assets.issues], coverageIssues = [], packages = new Map();
    const add = (directory, inclusion, expected) => {
        const file = path.join(inside(root,directory),'package.json');
        if (!fs.existsSync(file)) {issues.push(`Missing package metadata: ${directory}`);return;}
        const bytes=fs.readFileSync(file), pkg=JSON.parse(bytes), key=portable(path.relative(root,path.dirname(file)));
        if (expected && (sha256(bytes)!==expected.packageJsonSha256 || pkg.name!==expected.name || pkg.version!==expected.version)) issues.push(`Build inventory is stale: ${directory}`);
        const current=packages.get(key) || {root:key,name:pkg.name,version:pkg.version,license:typeof pkg.license==='string'?pkg.license:'NOASSERTION',inclusions:[],metadata:pkg};
        if (!current.inclusions.includes(inclusion)) current.inclusions.push(inclusion);
        packages.set(key,current);
    };
    for (const [compiler,base] of [['main','main'],['preload','main'],['renderer','renderer']]) {
        const file=path.join(root,`dist/${base}/legal-inputs/${compiler}.json`);
        if (!fs.existsSync(file)) {issues.push(`Missing ${compiler} build inventory; rebuild all three webpack targets.`);continue;}
        const input=json(file);
        if (input.schemaVersion!==1 || input.compiler!==compiler || !Array.isArray(input.packages)) throw new Error(`Invalid ${compiler} build inventory.`);
        for (const pkg of input.packages) add(pkg.root,`compiled:${compiler}`,pkg);
    }
    const webInput=path.join(root,'dist/main/export-runtime/dependencies.json');
    if (!fs.existsSync(webInput)) issues.push('Missing standalone export runtime dependency inventory; rebuild the main target.');
    else for (const pkg of json(webInput).packages) add(pkg.root,'compiled:export-runtime',pkg);
    // These packages are copied, rather than imported through webpack. Include nested package roots too.
    for (const base of ['dist/main/node_modules','dist/renderer/assets/vendor']) {
        for (const file of walk(path.join(root,base)).filter(file=>path.basename(file)==='package.json')) {
            const pkg=json(file);if (!pkg.name || !pkg.version) continue;
            const directory=portable(path.relative(root,path.dirname(file)));
            const installed='node_modules/'+directory.slice(base.length+1);
            // Prefer copied metadata/notices so copied-only dependencies are covered as well.
            add(fs.existsSync(path.join(root,installed,'package.json')) ? installed : directory,`copied:${directory}`);
        }
    }
    add('node_modules/electron','desktop-runtime');
    const context=sourceContext(root);
    const inventory = {schemaVersion:1,project:{name:metadata.name,version:metadata.version,license:metadata.license},source:context,target:{platform,arch},
        lockSha256:sha256(fs.readFileSync(path.join(root,'package-lock.json'))),
        scope:'JavaScript module packages, copied packages/assets and staged native inputs. Native embedded dependency coverage remains subject to review.json; this is not a complete native SBOM.',
        productionDependencyGraph:Object.entries(lock.packages || {}).filter(([name,pkg])=>name && !pkg.dev).map(([name,pkg])=>({path:name,version:pkg.version,license:pkg.license || 'NOASSERTION',integrity:pkg.integrity})),packages:[]};
    fs.mkdirSync(output,{recursive:true});
    // Generate in a fresh directory; stale notices must not survive dependency removals.
    fs.rmSync(path.join(output,'licenses'),{recursive:true,force:true});
    fs.mkdirSync(path.join(output,'licenses'),{recursive:true});
    const copyNotice=(file,name) => {
        const bytes=fs.readFileSync(file), filename=`${sha256(bytes)}.txt`;
        fs.writeFileSync(path.join(output,'licenses',filename),bytes);
        return {source:name,path:'licenses/'+filename,sha256:sha256(bytes)};
    };
    const projectNotice=copyNotice(path.join(root,'LICENSE'),'LICENSE');
    const notices=[`FDO ${metadata.version} — third-party notices`,
        'The project MIT license applies to original FDO material where the contributor has those rights. Third-party components keep their own terms. Trademark rights are not granted by this document.',
        'Coverage and unresolved items: inventory.json, asset-inventory.json and review-status.json. Package metadata is not a legal clearance or a complete list of dependencies embedded in native binaries.',
        `Source commit: ${context.commit || 'unknown'}; working tree dirty: ${context.dirty}`,fs.readFileSync(path.join(root,'LICENSE'),'utf8')];
    for (const pkg of [...packages.values()].sort((a,b)=>a.root.localeCompare(b.root))) {
        const directory=path.join(root,pkg.root), originals=licenseFiles(directory);
        if (pkg.root.startsWith('packages/')) originals.push(path.join(root,'LICENSE'));
        // Version-specific upstream recovery: the npm CLI package omits Apache LICENSE/NOTICE.
        if (/^@openai\/codex(?:-|$)/.test(pkg.name) && pkg.version.startsWith('0.162.1')) originals.push(...['codex-0.162.1-LICENSE','codex-0.162.1-NOTICE'].map(name=>path.join(root,'third_party/licenses',name)));
        if (pkg.name==='exif-parser' && pkg.version==='0.1.12' && originals.some(file=>path.basename(file)==='LICENSE.md')) pkg.license='MIT';
        const recovered={
            '@bufbuild/protobuf@1.10.0':['protobuf-es-1.10.0-LICENSE','protobuf-es-1.10.0-GOOGLE-NOTICE.txt'],
            '@connectrpc/connect@1.7.0':['connect-es-1.7.0-LICENSE'],
            '@connectrpc/connect-web@1.7.0':['connect-es-1.7.0-LICENSE'],
            'tree-sitter@0.21.1':['tree-sitter-0.21.1-LICENSE'],
            'tree-sitter-bash@0.21.0':['tree-sitter-bash-0.21.0-LICENSE'],
            'data-uri-to-buffer@4.0.1':['data-uri-to-buffer-4.0.1-LICENSE.txt'],
            'isarray@1.0.0':['isarray-1.0.0-LICENSE.txt'],
            'omggif@1.0.10':['omggif-1.0.10-NOTICE.txt'],
            'standardwebhooks@1.1.1':['standardwebhooks-1.1.1-LICENSE'],
            'upper-case@2.0.2':['upper-case-2.0.2-LICENSE'],
            'victory-vendor@37.3.6':['victory-37.3.6-LICENSE.txt'],
        };
        for (const name of recovered[`${pkg.name}@${pkg.version}`] || []) originals.push(path.join(root,'third_party/licenses',name));
        if (pkg.name==='victory-vendor' && pkg.version==='37.3.6') originals.push(...walk(path.join(directory,'lib-vendor')).filter(file=>/^licen[cs]e$/i.test(path.basename(file))));
        if (pkg.root.startsWith('node_modules/goober/') && json(path.join(root,'node_modules/goober/package.json')).version==='2.1.19') originals.push(path.join(root,'node_modules/goober/LICENSE'));
        if (pkg.name.startsWith('@esbuild/') && pkg.version===json(path.join(root,'node_modules/esbuild/package.json')).version) originals.push(path.join(root,'node_modules/esbuild/LICENSE.md'));
        // Cursor platform packages defer to the parent license; this does not clear redistribution.
        if (/^@cursor\/sdk-/.test(pkg.name) && pkg.version==='1.0.40') originals.push(path.join(root,'node_modules/@cursor/sdk/LICENSE.md'));
        const unique=[...new Set(originals)];
        const files=unique.map(file=>copyNotice(file,portable(path.relative(root,file))));
        if (!files.length) coverageIssues.push(`No original license/notice file recovered: ${pkg.name}@${pkg.version} (${pkg.root})`);
        const locked=lock.packages?.[pkg.root];
        const {metadata:raw,...record}=pkg;
        record.inclusions.sort();
        record.notices=files;record.packageJsonSha256=sha256(fs.readFileSync(path.join(directory,'package.json')));
        record.repository=typeof raw.repository==='string'?raw.repository:raw.repository?.url;
        record.author=raw.author;
        record.integrity=locked?.integrity;record.resolved=locked?.resolved;
        inventory.packages.push(record);
        notices.push(`\n--- ${record.name} ${record.version} ---\nDeclared license: ${record.license}\nIncluded by: ${record.inclusions.join(', ')}\nSource: ${record.repository || record.resolved || record.root}`);
        for (const file of unique) notices.push(`\n[${portable(path.relative(root,file))}]\n${fs.readFileSync(file,'utf8')}`);
    }
    for (const group of assets.groups) {
        notices.push(`\n--- ${group.name} ${group.version} ---\nLicense: ${group.license}\nSource: ${group.source}\n${group.note}\nIncluded files: see asset-inventory.json`);
        for (const name of group.licenseFiles) notices.push(fs.readFileSync(path.join(root,'third_party/licenses',name),'utf8'));
    }
    for (const file of walk(path.join(root,'third_party/licenses'))) copyNotice(file,portable(path.relative(root,file)));
    const electronNotices=electronNoticesPath || path.join(root,'node_modules/electron/dist/LICENSES.chromium.html');
    if (!fs.existsSync(electronNotices)) issues.push('Electron/Chromium third-party notices are missing.');
    else {fs.copyFileSync(electronNotices,path.join(output,'LICENSES.chromium.html'));notices.push('\nElectron/Chromium: see LICENSES.chromium.html, reproduced alongside these notices.');}
    const gitFile=path.join(root,'node_modules/dugite/script/embedded-git.json');
    const gitArchives=fs.existsSync(gitFile)?json(gitFile):{};
    const gitDirectory=path.join(root,`dist/main/git-${arch}`);
    if (!fs.existsSync(gitDirectory)) issues.push(`Missing staged Git distribution: dist/main/git-${arch}. Run the packaging preparation hook.`);
    inventory.nativeInputs={hashScope:'Staged files BEFORE code signing/packager filtering; final artifact hashes are in SHA256SUMS. This is a file inventory, not identification of every embedded library.',
        gitArchive:gitArchives[`${platform}-${arch}`] || null,
        files:[...walk(gitDirectory),...walk(path.join(root,'dist/main/node_modules')).filter(file=>/\/vendor\/|\/bin\/|\.(?:node|dll|dylib|so|exe)$|\/lib\/tsc$/.test(portable(file)))].map(file=>({path:portable(path.relative(root,file)),size:fs.statSync(file).size,sha256:sha256(fs.readFileSync(file))}))};
    const status={schemaVersion:1,releaseReady:!issues.length && !coverageIssues.length && !pending.length && context.dirty===false,issues,coverageIssues,pending,source:context};
    writeJson(path.join(output,'inventory.json'),inventory);
    writeJson(path.join(output,'asset-inventory.json'),{schemaVersion:1,groups:assets.groups});
    writeJson(path.join(output,'review-status.json'),status);
    fs.copyFileSync(path.join(root,'third_party/review.json'),path.join(output,'review.json'));
    fs.copyFileSync(path.join(root,'third_party/source-evidence.json'),path.join(output,'source-evidence.json'));
    fs.copyFileSync(path.join(root,'third_party/recovered-notices.json'),path.join(output,'recovered-notices.json'));
    fs.writeFileSync(path.join(output,'THIRD_PARTY_NOTICES.txt'),notices.join('\n')+'\n');
    const bom={bomFormat:'CycloneDX',specVersion:'1.6',version:1,metadata:{component:{type:'application',name:metadata.name,version:metadata.version},properties:[{name:'fdo:source:commit',value:context.commit || 'unknown'},{name:'fdo:source:dirty',value:String(context.dirty)},{name:'fdo:coverage',value:inventory.scope}]},
        components:inventory.packages.map(pkg=>({type:'library',name:pkg.name,version:pkg.version,'bom-ref':pkg.root,purl:`pkg:npm/${pkg.name.replace('@','%40')}@${pkg.version}`,
            properties:[{name:'fdo:inclusions',value:pkg.inclusions.join(',')},{name:'fdo:declared-license',value:pkg.license},{name:'fdo:package-json-sha256',value:pkg.packageJsonSha256}],
            ...(pkg.license!=='NOASSERTION' && !pkg.license.startsWith('SEE ') ? {licenses:[{license:{name:pkg.license}}]} : {})}))};
    for (const group of assets.groups) bom.components.push({type:'library',name:group.name,version:group.version,'bom-ref':'asset:'+group.id,
        properties:[{name:'fdo:declared-license',value:group.license},{name:'fdo:asset-tree-sha256',value:group.actualTreeSha256},{name:'fdo:source',value:group.source},{name:'fdo:coverage',value:group.note}]});
    if (inventory.nativeInputs.gitArchive) bom.components.push({type:'application',name:'Dugite native Git distribution',version:inventory.nativeInputs.gitArchive.name,'bom-ref':'native:git',
        properties:[{name:'fdo:source',value:inventory.nativeInputs.gitArchive.url},{name:'fdo:archive-sha256',value:inventory.nativeInputs.gitArchive.checksum},{name:'fdo:coverage',value:'Top-level distribution only; native component and corresponding-source review pending.'}]});
    writeJson(path.join(output,'sbom.cdx.json'),bom);
    writeJson(path.join(output,'files.json'),{schemaVersion:1,files:walk(output).filter(file=>path.basename(file)!=='files.json').map(file=>({path:portable(path.relative(output,file)),sha256:sha256(fs.readFileSync(file))})),projectLicense:projectNotice});
    if (issues.length || release && !status.releaseReady) throw new Error(`Licensing inventory requires attention:\n${[...issues,...(release?[...coverageIssues,...pending.map(item=>`${item.id}: ${item.action}`)]:[]),...(release&&context.dirty!==false?['A clean source checkout is required for release clearance.']:[])].join('\n')}`);
    return {inventory,status};
}
module.exports={generate,checkAssets,checkReview,licenseFiles,walk,sha256,inside};
function main() {
    if (process.argv.includes('--review')) {
        const pending=checkReview(process.cwd());
        if (pending.length) {
            const message='Unresolved licensing/provenance review items: '+pending.map(item=>item.id).join(', ');
            if (process.argv.includes('--strict')) throw new Error(message);
            console.warn((process.env.GITHUB_ACTIONS==='true'?'::warning::':'Warning: ')+message);
        }
    } else {
        const {inventory,status}=generate({release:process.argv.includes('--release')});
        console.log(`Licensing inventory: ${inventory.packages.length} packages, ${status.pending.length} pending reviews, ${status.coverageIssues.length} missing package notices. dist/legal`);
    }
}
if (require.main===module) {
    try {main();} catch (error) {console.error(error.message);process.exitCode=1;}
}
