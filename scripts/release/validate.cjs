'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {git, validateRelease, readJson} = require('./common.cjs');
function main(env = process.env, directory = process.cwd()) {
    const pkg = readJson(path.join(directory, 'package.json')), lock = readJson(path.join(directory, 'package-lock.json'));
    const result = validateRelease({ref: env.GITHUB_REF || '', version: pkg.version, lockVersion: lock.version, lockRootVersion: lock.packages?.['']?.version});
    const commit = git(['rev-parse', 'HEAD'], directory);
    if (result.publish) {
        if (git(['rev-parse', `refs/tags/${result.tag}^{commit}`], directory) !== commit) throw new Error('Checked-out commit does not match the release tag.');
        const branch = env.DEFAULT_BRANCH;
        if (!branch) throw new Error('DEFAULT_BRANCH is required for a tagged release.');
        git(['merge-base', '--is-ancestor', commit, `refs/remotes/origin/${branch}`], directory);
    }
    if (env.GITHUB_OUTPUT) fs.appendFileSync(env.GITHUB_OUTPUT, Object.entries({...result, commit}).map(([key, value]) => `${key}=${value}\n`).join(''));
    console.log(`${result.publish ? 'Release' : 'Build-only rehearsal'}: ${pkg.version} at ${commit}`);
    return {...result, commit};
}
module.exports = {main};
if (require.main === module) {try {main();} catch (error) {console.error(error.message);process.exitCode = 1;}}
