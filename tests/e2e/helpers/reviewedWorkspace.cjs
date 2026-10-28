const path = require('node:path');
const {createRequire} = require('node:module');
const {createHash} = require('node:crypto');
const esbuild = require('esbuild');
let cachedFiles;

// Recovery/transport recordings start inside an already reviewed workspace.
// Read the SDK and host contract fingerprint without executing workspace code.
function reviewedWorkspaceFiles() {
    if (cachedFiles) return cachedFiles;
    const loaded = {exports: Object.create(null)};
    const source = esbuild.buildSync({stdin: {contents: `
        export {installedSdkCapabilities} from './src/utils/sdk/installedSdkCapabilities.js';
        export {workspaceAuthoringContract} from './src/utils/sdk/pluginAuthoringContract.js';
    `, resolveDir: process.cwd()},
        bundle: true, platform: 'node', format: 'cjs', write: false}).outputFiles[0].text;
    new Function('require', 'module', 'exports', source)(require, loaded, loaded.exports);
    const requireSdk = createRequire(path.resolve('dist/main/node_modules/fixture-sdk-context.cjs'));
    const capabilities = loaded.exports.installedSdkCapabilities(requireSdk, {});
    const {host, contract} = loaded.exports.workspaceAuthoringContract();
    const fingerprint = createHash('sha256').update(capabilities.fingerprint)
        .update(JSON.stringify({host, contract})).digest('hex');
    const testFile = '/fixture-sdk-baseline.test.ts';
    cachedFiles = [
        {path: '/SKILL.md', content: '# Reviewed SDK fixture workspace\n\nKeep the existing SDK baseline test intact. Generate only the requested implementation changes.\n\n<!-- fdo-acceptance -->\n~~~json\n'
            + JSON.stringify([{id: 'sdk-baseline', description: 'The installed SDK text helper preserves baseline text.', testFile, testName: 'SDK baseline text'}])
            + '\n~~~\n\n<!-- fdo-sdk-fingerprint: ' + fingerprint + ' -->\n'},
        {path: testFile, content: `import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DOMText} from '@anikitenko/fdo-sdk';
test('SDK baseline text', () => {
    const html = new DOMText().createSpanText('Fixture baseline', {});
    assert.match(html, /^<span/);
    assert.match(html, /Fixture baseline/);
});`},
    ];
    return cachedFiles;
}

async function installReviewedWorkspaceFixture(page) {
    await page.evaluate(files => {
        window.__withReviewedWorkspace = request => {
            const existing = request.workspaceFiles || [];
            // Never replace a supplied guide, including intentional stale-guide cases.
            if (existing.some(file => file.path === '/SKILL.md')) return request;
            return {...request, workspaceFiles: [...files, ...existing]};
        };
    }, reviewedWorkspaceFiles());
}
module.exports = {installReviewedWorkspaceFixture};
