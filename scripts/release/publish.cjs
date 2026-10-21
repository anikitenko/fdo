'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {git, parseVersion, compareVersions, sha256, readJson} = require('./common.cjs');
function githubApi(token, fetcher = fetch) {
    return async (method, endpoint, body, binary = false) => {
        const url = new URL(endpoint, 'https://api.github.com');
        if (url.protocol !== 'https:' || !['api.github.com', 'uploads.github.com'].includes(url.hostname)) throw new Error('Untrusted GitHub API URL.');
        const response = await fetcher(url, {method, headers: {Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(body ? {'Content-Type': binary ? 'application/octet-stream' : 'application/json', ...(binary ? {'Content-Length': String(fs.statSync(body.path).size)} : {})} : {})},
            body: binary ? body : body ? JSON.stringify(body) : undefined, ...(binary ? {duplex: 'half'} : {}), signal: AbortSignal.timeout(binary ? 600000 : 60000)});
        if (!response.ok) throw Object.assign(new Error(`GitHub ${method} ${url.pathname} failed (${response.status}).`), {status: response.status});
        return response.status === 204 ? null : response.json();
    };
}
async function paginate(api, endpoint) {
    const items = [];
    for (let page = 1; ; page++) {const batch = await api('GET', `${endpoint}${endpoint.includes('?') ? '&' : '?'}per_page=100&page=${page}`);items.push(...batch);if (batch.length < 100) return items;}
}
function previousRelease(releases, version, isAncestor) {
    const prerelease = !!parseVersion(version).prerelease;
    return releases.filter(release => {
        try {return !release.draft && (prerelease || !release.prerelease) && release.tag_name.startsWith('v') && compareVersions(release.tag_name.slice(1), version) < 0 && isAncestor(release.tag_name);}
        catch {return false;}
    }).sort((a, b) => compareVersions(b.tag_name.slice(1), a.tag_name.slice(1)))[0]?.tag_name;
}
function notes({generated, history, repository, tag, previous, manifest}) {
    const body = [generated.slice(0, 70000), '\n## Downloads and verification',
        'Installers are attached below. `SHA256SUMS` covers every installer and `release-manifest.json`; the manifest records source commit, platform and signing status.',
        '\nmacOS installers are Developer ID signed and notarized.',
        '\nWindows installers are published unsigned.',
        `\nSource: [${manifest.commit.slice(0, 12)}](https://github.com/${repository}/commit/${manifest.commit}).`,
        '\n<details>\n<summary>Commit history (up to 200 commits, newest first)</summary>\n',
        ...history.map(({sha, subject}) => `- ${subject.slice(0, 220).replace(/[\\`*_{}\[\]<>!|]/g, '\\$&')} ([${sha.slice(0, 8)}](https://github.com/${repository}/commit/${sha}))`),
        '\n</details>', `\n[Full changelog](https://github.com/${repository}/${previous ? `compare/${encodeURIComponent(previous)}...${encodeURIComponent(tag)}` : `commits/${encodeURIComponent(tag)}`})`, `\n<!-- fdo-release:${manifest.commit} -->`];
    return body.join('\n');
}
async function publish({repository, version, commit, directory, api, isAncestor, history}) {
    if (!/^[\w.-]+\/[\w.-]+$/.test(repository)) throw new Error('Invalid repository.');
    const prerelease = !!parseVersion(version).prerelease, tag = `v${version}`, base = `/repos/${repository}`;
    const manifest = readJson(path.join(directory, 'release-manifest.json'));
    if (manifest.version !== version || manifest.commit !== commit) throw new Error('Release manifest does not match source.');
    const inventory = fs.readdirSync(directory).sort();
    for (const name of inventory) if (!fs.lstatSync(path.join(directory, name)).isFile()) throw new Error('Release directory must contain regular files.');
    const sums = fs.readFileSync(path.join(directory, 'SHA256SUMS'), 'utf8').trim().split('\n');
    const expected = new Map();
    for (const line of sums) {
        const match = line.match(/^([a-f0-9]{64}) {2}([^/\\]+)$/);
        if (!match || expected.has(match[2])) throw new Error('Invalid checksum inventory.');
        expected.set(match[2], match[1]);
    }
    if (expected.size !== inventory.length - 1 || inventory.some(name => name !== 'SHA256SUMS' && !expected.has(name))) throw new Error('Release checksum inventory is incomplete.');
    for (const [name, digest] of expected) if (await sha256(path.join(directory, name)) !== digest) throw new Error(`Release checksum mismatch: ${name}`);
    const verifyTag = async () => {
        let object = (await api('GET', `${base}/git/ref/tags/${encodeURIComponent(tag)}`)).object;
        for (let depth = 0; object?.type === 'tag' && depth < 10; depth++) object = (await api('GET', `${base}/git/tags/${object.sha}`)).object;
        if (object?.type !== 'commit' || object.sha !== commit) throw new Error('Release tag moved or does not match the tested source commit.');
    };
    await verifyTag();
    const releases = await paginate(api, `${base}/releases`);
    const existing = releases.find(release => release.tag_name === tag);
    if (existing && !existing.draft) throw new Error('Release is already published. Published assets are never replaced.');
    if (existing && (existing.target_commitish !== commit || !existing.body?.includes(`<!-- fdo-release:${commit} -->`))) throw new Error('Existing draft belongs to a different release source.');
    if (!prerelease && releases.some(release => {try {return !release.draft && !release.prerelease && compareVersions(release.tag_name.replace(/^v/, ''), version) >= 0;} catch {return false;}})) throw new Error('Stable releases must increase the latest stable version.');
    const previous = previousRelease(releases, version, isAncestor);
    const generated = await api('POST', `${base}/releases/generate-notes`, {tag_name: tag, target_commitish: commit, ...(previous ? {previous_tag_name: previous} : {}), configuration_file_path: '.github/release.yml'});
    const body = notes({generated: generated.body || '', history: history(previous), repository, tag, previous, manifest});
    const release = existing
        ? await api('PATCH', `${base}/releases/${existing.id}`, {name: `FDO ${version}`, body, prerelease})
        : await api('POST', `${base}/releases`, {tag_name: tag, target_commitish: commit, name: `FDO ${version}`, body, prerelease, draft: true});
    let assets = await paginate(api, `${base}/releases/${release.id}/assets`);
    const unexpected = assets.filter(asset => !inventory.includes(asset.name));
    if (unexpected.length) throw new Error('Draft has unexpected assets. Review the draft before retrying.');
    for (const name of inventory) {
        const file = path.join(directory, name), size = fs.statSync(file).size, digest = `sha256:${await sha256(file)}`;
        const old = assets.find(asset => asset.name === name);
        if (old && old.size === size && old.digest === digest) continue;
        if (old) await api('DELETE', `${base}/releases/assets/${old.id}`);
        const url = new URL(release.upload_url.split('{')[0]);url.searchParams.set('name', name);
        const stream = fs.createReadStream(file);let uploaded;
        try {uploaded = await api('POST', url.href, stream, true);} finally {stream.destroy();}
        if (uploaded.size !== size || uploaded.digest && uploaded.digest !== digest) throw new Error(`Upload integrity check failed: ${name}`);
    }
    assets = await paginate(api, `${base}/releases/${release.id}/assets`);
    if (assets.length !== inventory.length || inventory.some(name => !assets.some(asset => asset.name === name && asset.state === 'uploaded'))) throw new Error('Release upload is incomplete; draft retained.');
    await verifyTag();
    return api('PATCH', `${base}/releases/${release.id}`, {draft: false, prerelease, make_latest: prerelease ? 'false' : 'true'});
}
module.exports = {githubApi, previousRelease, notes, publish};
if (require.main === module) {
    const env = process.env;
    if (!env.GH_TOKEN) {console.error('GH_TOKEN is required.');process.exitCode = 1;}
    else publish({repository: env.GITHUB_REPOSITORY, version: env.RELEASE_VERSION, commit: env.RELEASE_COMMIT, directory: 'release-assets', api: githubApi(env.GH_TOKEN),
        isAncestor: tag => {try {git(['merge-base', '--is-ancestor', `refs/tags/${tag}`, 'HEAD']);return true;} catch {return false;}},
        history: previous => git(['log', '--no-merges', '-200', '--format=%H%x00%s', previous ? `${previous}..HEAD` : 'HEAD']).split('\n').filter(Boolean).map(line => {const [sha, subject] = line.split('\0');return {sha, subject};}),
    }).then(release => {console.log(`Published ${release.html_url}`);if (env.GITHUB_STEP_SUMMARY) fs.appendFileSync(env.GITHUB_STEP_SUMMARY, `Published [FDO ${env.RELEASE_VERSION}](${release.html_url})\n`);}).catch(error => {console.error(error.message);process.exitCode = 1;});
}
