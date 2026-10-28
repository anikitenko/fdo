'use strict';
const fs = require('node:fs');
const path = require('node:path');

function validateSdkRelease(pkg, lock, latest) {
    const name = '@anikitenko/fdo-sdk';
    if (!/^\d+\.\d+\.\d+$/.test(latest || '')) throw new Error('The SDK registry did not return a stable release version.');
    const declared = pkg.dependencies?.[name];
    const locked = lock.packages?.[`node_modules/${name}`]?.version;
    if (declared !== latest || locked !== latest || lock.packages?.['']?.dependencies?.[name] !== latest) {
        throw new Error(`FDO releases must include the latest stable SDK (${latest}). Declared: ${declared}; locked: ${locked}. Run npm install --save-exact ${name}@${latest}, validate, and commit package.json and package-lock.json.`);
    }
    return latest;
}

async function main({directory = process.cwd(), fetchRegistry = fetch} = {}) {
    const response = await fetchRegistry('https://registry.npmjs.org/@anikitenko%2Ffdo-sdk/latest', {signal: AbortSignal.timeout(20000)});
    if (!response.ok) throw new Error(`Unable to verify the latest SDK release: registry HTTP ${response.status}.`);
    const latest = (await response.json()).version;
    const read = name => JSON.parse(fs.readFileSync(path.join(directory, name), 'utf8'));
    validateSdkRelease(read('package.json'), read('package-lock.json'), latest);
    console.log(`SDK release check passed: FDO bundles the latest stable SDK ${latest}.`);
}

module.exports = {validateSdkRelease, main};
if (require.main === module) main().catch(error => {console.error(error.message); process.exitCode = 1;});
