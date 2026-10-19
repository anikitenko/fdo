/** @jest-environment node */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const yaml = require('js-yaml');
const {parseVersion, compareVersions, validateRelease, assetNames, platforms, sha256} = require('../../scripts/release/common.cjs');
const {releaseConfig} = require('../../scripts/release/build.cjs');
const {stage, assemble} = require('../../scripts/release/artifacts.cjs');
const {githubApi, publish, previousRelease, notes} = require('../../scripts/release/publish.cjs');
let root;
const commit = 'a'.repeat(40);
beforeEach(() => {root = fs.mkdtempSync(path.join(os.tmpdir(), 'fdo-release-'));});
afterEach(() => fs.rmSync(root, {recursive: true, force: true}));
test('validates tag, package and lock versions and classifies prereleases', () => {
    expect(validateRelease({ref:'refs/tags/v1.2.3-rc.1',version:'1.2.3-rc.1',lockVersion:'1.2.3-rc.1',lockRootVersion:'1.2.3-rc.1'})).toMatchObject({publish:true,prerelease:true});
    expect(validateRelease({ref:'refs/heads/main',version:'1.0.0',lockVersion:'1.0.0',lockRootVersion:'1.0.0'}).publish).toBe(false);
    for (const version of ['01.0.0','1.0','1.0.0-01','1.0.0;bad']) expect(()=>parseVersion(version)).toThrow();
    expect(()=>validateRelease({ref:'refs/tags/v2.0.0',version:'1.0.0',lockVersion:'1.0.0',lockRootVersion:'1.0.0'})).toThrow('Tag must');
    expect(()=>validateRelease({ref:'refs/heads/main',version:'1.0.0',lockVersion:'0.9.0',lockRootVersion:'1.0.0'})).toThrow('versions');
    expect(compareVersions('1.0.0-rc.10','1.0.0-rc.2')).toBe(1);expect(compareVersions('1.0.0','1.0.0-rc.2')).toBe(1);
});
test('stable builds require credentials; branch rehearsals cannot sign or publish', () => {
    const metadata = require('../../package.json');
    for (const platform of ['mac','win']) expect(()=>releaseConfig({...metadata,version:'1.0.0'},{platform,arch:'x64',publish:true,env:{}})).toThrow('require');
    const mac = releaseConfig({...metadata,version:'1.0.0'},{platform:'mac',arch:'arm64',publish:true,env:{MAC_CSC_LINK:'certificate',APPLE_ID:'id',APPLE_APP_SPECIFIC_PASSWORD:'password',APPLE_TEAM_ID:'team'}});
    expect(mac).toMatchObject({signed:true,notarized:true,config:{forceCodeSigning:true,publish:null}});
    expect(releaseConfig({...metadata,version:'1.0.0-rc.1'},{platform:'mac',arch:'arm64',publish:true,env:{}})).toMatchObject({signed:false,notarized:false});
    const rehearsal = releaseConfig(metadata,{platform:'win',arch:'x64',publish:false,env:{WIN_CSC_LINK:'present'}});
    expect(rehearsal.signed).toBe(false);expect(rehearsal.config.publish).toBeNull();
    expect(rehearsal.config.nsis.artifactName).not.toBe(rehearsal.config.portable.artifactName);
});
async function fixture(version = '1.0.0-rc.1', signed = false) {
    const download = path.join(root,'download');fs.mkdirSync(download);
    for (const platform of Object.keys(platforms)) {
        const source = path.join(root,platform), destination = path.join(download,platform);fs.mkdirSync(source,{recursive:true});
        for (const file of assetNames(version,platform)) fs.writeFileSync(path.join(source,file),`${platform} binary ${file}`);
        await stage({source,destination,version,commit,platform,signed,notarized:signed && platform.startsWith('mac-')});
    }
    return download;
}
test('assembles exactly nine unique installers, checksums and a source manifest', async () => {
    const source = await fixture(), destination = path.join(root,'assets');
    const result = await assemble({source,destination,version:'1.0.0-rc.1',commit});
    expect(result.builds).toHaveLength(4);expect(fs.readdirSync(destination)).toHaveLength(11);
    for (const line of fs.readFileSync(path.join(destination,'SHA256SUMS'),'utf8').trim().split('\n')) {
        const [digest,name] = line.split('  ');expect(await sha256(path.join(destination,name))).toBe(digest);
    }
});
test('rejects missing platforms, tampered bytes, duplicate assets and unsigned stable releases', async () => {
    const source = await fixture();
    const asset = path.join(source,'mac-arm64',assetNames('1.0.0-rc.1','mac-arm64')[0]);fs.appendFileSync(asset,'tampered');
    await expect(assemble({source,destination:path.join(root,'out'),version:'1.0.0-rc.1',commit})).rejects.toThrow('checksum');
    fs.copyFileSync(asset,path.join(source,path.basename(asset)));
    await expect(assemble({source,destination:path.join(root,'out'),version:'1.0.0-rc.1',commit})).rejects.toThrow('Duplicate');
    fs.rmSync(source,{recursive:true});const stable = await fixture('1.0.0');
    await expect(assemble({source:stable,destination:path.join(root,'stable'),version:'1.0.0',commit,stable:true})).rejects.toThrow('signed');
    fs.unlinkSync(path.join(stable,'mac-x64','mac-x64.json'));
    await expect(assemble({source:stable,destination:path.join(root,'missing'),version:'1.0.0',commit})).rejects.toThrow('Missing build manifest');
});
test('release history excludes drafts, non-ancestors and prereleases for stable comparisons', () => {
    const releases = [{tag_name:'v1.0.0',draft:false,prerelease:false},{tag_name:'v1.1.0-rc.1',draft:false,prerelease:true},{tag_name:'v1.0.5',draft:false,prerelease:false},{tag_name:'v1.0.9',draft:true}];
    const ancestor = tag => tag !== 'v1.0.5';
    expect(previousRelease(releases,'1.1.0',ancestor)).toBe('v1.0.0');
    expect(previousRelease(releases,'1.1.0-rc.2',ancestor)).toBe('v1.1.0-rc.1');
    const body = notes({generated:'## Changes\nPR #1',history:[{sha:commit,subject:'fix: <unsafe> [text]'}],repository:'owner/repo',tag:'v1.0.0-rc.1',manifest:{commit,builds:[{platform:'mac-x64',signed:false}]}});
    expect(body).toContain('Unsigned prerelease');expect(body).toContain('Commit history');expect(body).toContain('PR #1');expect(body).toContain('\\<unsafe\\>');
});
function fakeApi({failUpload = false, published = false} = {}) {
    const state = {published, assets:[], calls:[], draft:null};
    const api = jest.fn(async(method,endpoint,body,binary)=>{
        state.calls.push({method,endpoint,body,binary});
        if(endpoint.includes('/git/ref/tags/'))return {object:{type:'commit',sha:commit}};
        if(method==='GET' && endpoint.includes('/releases?'))return state.draft?[state.draft]:published?[{tag_name:'v1.0.0-rc.1',draft:false}]:[];
        if(endpoint.endsWith('/generate-notes'))return {body:'Automatic PR notes'};
        if(method==='POST' && endpoint.endsWith('/releases')){state.draft={id:1,upload_url:'https://uploads.github.com/repos/owner/repo/releases/1/assets{?name,label}',...body};return state.draft;}
        if(method==='GET' && endpoint.includes('/assets?'))return state.assets;
        if(binary){for await(const chunk of body)void chunk;if(failUpload)throw new Error('upload failed');const name=new URL(endpoint).searchParams.get('name');const asset={id:state.assets.length+1,name,size:fs.statSync(path.join(root,'assets',name)).size,state:'uploaded'};state.assets.push(asset);return asset;}
        if(method==='DELETE'){state.assets=state.assets.filter(asset=>!endpoint.endsWith('/'+asset.id));return null;}
        if(method==='PATCH'){if(body.draft===false)state.published=true;Object.assign(state.draft,body);return state.draft;}
        throw new Error(`Unexpected API call: ${method} ${endpoint}`);
    });
    return {state,api};
}
test('publishes only after every asset uploads; failed uploads leave an unpublished draft', async () => {
    const source=await fixture(),directory=path.join(root,'assets');await assemble({source,destination:directory,version:'1.0.0-rc.1',commit});
    const broken=fakeApi({failUpload:true});
    await expect(publish({repository:'owner/repo',version:'1.0.0-rc.1',commit,directory,api:broken.api,isAncestor:()=>true,history:()=>[]})).rejects.toThrow('upload failed');
    expect(broken.state.draft.draft).toBe(true);expect(broken.state.published).toBe(false);
    const good=fakeApi();await publish({repository:'owner/repo',version:'1.0.0-rc.1',commit,directory,api:good.api,isAncestor:()=>true,history:()=>[]});
    expect(good.state.assets).toHaveLength(11);expect(good.state.calls.at(-1).body).toEqual({draft:false,prerelease:true,make_latest:'false'});
    const immutable=fakeApi({published:true});await expect(publish({repository:'owner/repo',version:'1.0.0-rc.1',commit,directory,api:immutable.api,isAncestor:()=>true,history:()=>[]})).rejects.toThrow('already published');
    expect(immutable.state.calls.every(call=>call.method==='GET')).toBe(true);
});
test('workflow contracts gate publication and freeze action versions', () => {
    const workflow=yaml.load(fs.readFileSync('.github/workflows/release_matrix.yml','utf8'));
    expect(workflow.permissions).toEqual({contents:'read'});
    expect(workflow.jobs.build.needs).toEqual(['validate','quality']);expect(workflow.jobs.quality.uses).toContain('editor_ui_tests.yml');
    expect(workflow.jobs.publish.needs).toEqual(['validate','assemble']);
    expect(workflow.jobs.assemble.steps.find(step=>step.uses?.startsWith('actions/download-artifact')).with.pattern).toBe('release-build-*');
    for(const job of Object.values(workflow.jobs))for(const step of job.steps||[])if(step.uses)expect(step.uses).toMatch(/@[a-f0-9]{40}$/);
    expect(workflow.jobs.build.steps.filter(step=>step.env?.MAC_CSC_LINK)).toHaveLength(2);
});

test('resumes a matching draft, skips byte-identical uploaded assets and refuses foreign drafts', async () => {
    const source=await fixture(),directory=path.join(root,'assets');await assemble({source,destination:directory,version:'1.0.0-rc.1',commit});
    const good=fakeApi();good.state.draft={id:1,tag_name:'v1.0.0-rc.1',target_commitish:commit,body:`<!-- fdo-release:${commit} -->`,draft:true,upload_url:'https://uploads.github.com/repos/owner/repo/releases/1/assets{?name,label}'};
    const name='SHA256SUMS',file=path.join(directory,name);
    good.state.assets=[{id:1,name,state:'uploaded',size:fs.statSync(file).size,digest:`sha256:${await sha256(file)}`}];
    await publish({repository:'owner/repo',version:'1.0.0-rc.1',commit,directory,api:good.api,isAncestor:()=>true,history:()=>[]});
    expect(good.state.calls.filter(call=>call.binary)).toHaveLength(10);expect(good.state.calls.some(call=>call.method==='DELETE')).toBe(false);
    const foreign=fakeApi();foreign.state.draft={id:1,tag_name:'v1.0.0-rc.1',target_commitish:'other',draft:true};
    await expect(publish({repository:'owner/repo',version:'1.0.0-rc.1',commit,directory,api:foreign.api,isAncestor:()=>true,history:()=>[]})).rejects.toThrow('different release source');
    expect(foreign.state.calls.every(call=>call.method==='GET')).toBe(true);
});
test('tag movement after upload leaves the release as a draft', async () => {
    const source=await fixture(),directory=path.join(root,'assets');await assemble({source,destination:directory,version:'1.0.0-rc.1',commit});
    const fake=fakeApi();let lookups=0;
    const api=async(...args)=>args[1].includes('/git/ref/tags/')?{object:{type:'commit',sha:++lookups===1?commit:'b'.repeat(40)}}:fake.api(...args);
    await expect(publish({repository:'owner/repo',version:'1.0.0-rc.1',commit,directory,api,isAncestor:()=>true,history:()=>[]})).rejects.toThrow('tag moved');
    expect(fake.state.assets).toHaveLength(11);expect(fake.state.published).toBe(false);
});
test('tampered assembled files and stable version regressions never publish', async () => {
    const source=await fixture('1.0.0',true),directory=path.join(root,'assets');await assemble({source,destination:directory,version:'1.0.0',commit,stable:true});
    const api=jest.fn(async(method,endpoint)=>endpoint.includes('/git/ref/tags/')?{object:{type:'commit',sha:commit}}:[{tag_name:'v2.0.0',draft:false,prerelease:false}]);
    await expect(publish({repository:'owner/repo',version:'1.0.0',commit,directory,api,isAncestor:()=>true,history:()=>[]})).rejects.toThrow('increase');
    expect(api.mock.calls.every(([method])=>method==='GET')).toBe(true);
    fs.appendFileSync(path.join(directory,assetNames('1.0.0','linux-x64')[0]),'tamper');api.mockClear();
    await expect(publish({repository:'owner/repo',version:'1.0.0',commit,directory,api,isAncestor:()=>true,history:()=>[]})).rejects.toThrow('checksum mismatch');
    expect(api).not.toHaveBeenCalled();
});
test('GitHub API requests cannot send the release token to an unrelated host', async () => {
    const fetcher=jest.fn();
    await expect(githubApi('secret',fetcher)('POST','https://example.com/upload',{})).rejects.toThrow('Untrusted');
    expect(fetcher).not.toHaveBeenCalled();
});

test('tag preflight accepts default-branch commits and rejects an unrelated tagged history', () => {
    const {execFileSync}=require('node:child_process');const {main}=require('../../scripts/release/validate.cjs');
    const hooks=path.join(root,'empty-hooks');fs.mkdirSync(hooks);
    const git=args=>execFileSync('git',['-c','commit.gpgSign=false','-c','tag.gpgSign=false','-c',`core.hooksPath=${hooks}`,...args],{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe'],env:{...process.env,GIT_AUTHOR_NAME:'Test',GIT_AUTHOR_EMAIL:'test@example.invalid',GIT_COMMITTER_NAME:'Test',GIT_COMMITTER_EMAIL:'test@example.invalid'}}).trim();
    git(['init','--initial-branch=main']);
    fs.writeFileSync(path.join(root,'package.json'),JSON.stringify({version:'1.0.0'}));
    fs.writeFileSync(path.join(root,'package-lock.json'),JSON.stringify({version:'1.0.0',packages:{'':{version:'1.0.0'}}}));
    git(['add','package.json','package-lock.json']);git(['commit','-m','release']);git(['tag','v1.0.0']);
    git(['update-ref','refs/remotes/origin/main','HEAD']);
    expect(main({GITHUB_REF:'refs/tags/v1.0.0',DEFAULT_BRANCH:'main'},root).publish).toBe(true);
    git(['checkout','--orphan','outside']);git(['add','package.json','package-lock.json']);git(['commit','-m','unrelated']);git(['tag','-f','v1.0.0']);
    expect(()=>main({GITHUB_REF:'refs/tags/v1.0.0',DEFAULT_BRANCH:'main'},root)).toThrow();
});
