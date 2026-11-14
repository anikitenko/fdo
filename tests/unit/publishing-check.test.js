/** @jest-environment node */
import {checkPublishingFiles} from '../../src/utils/plugins/publishing/publishingCheck';
import {buildPublishingAgentContext} from '../../src/utils/plugins/publishing/publishingAgentContext';
import {publishingFixture} from '../helpers/publishingFixture';
test('extracts the same proposal as the registry without executing plugin code', () => {
    const files = publishingFixture();
    files['index.ts'] += '\nthrow new Error("This must never execute");';
    const report = checkPublishingFiles(files);
    expect(report.valid).toBe(true);
    expect(report.proposal).toMatchObject({pluginId: 'release-console', capabilities: ['storage'], metadata: {version: '1.0.0'}});
});
test.each([
    [{scripts: {build: 'tsc'}}, 'scripts'],
    [{dependencies: {axios: '^1.0.0'}}, 'host-provided'],
    [{name: 'my-plugin'}, 'reserved'],
    [{fdo: {}}, 'fdo.compatibility'],
])('rejects registry package-policy violations %j', (patch, message) => {
    const report = checkPublishingFiles(publishingFixture(patch));
    expect(report.valid).toBe(false);
    expect(report.errors.join('\n')).toContain(message);
});
test('reports file paths, binary data, and case collisions with bounded registry rules', () => {
    const report = checkPublishingFiles({...publishingFixture(), 'image.png': Buffer.from([0]), '.config/settings.json': '{}', 'README.MD': 'duplicate'});
    expect(report.valid).toBe(false);
    expect(report.errors.join('\n')).toMatch(/image.png/);
    expect(report.errors.join('\n')).toMatch(/Hidden files/);
    expect(report.errors.join('\n')).toMatch(/Case-colliding/);
});
test('rejects computed capability declarations', () => {
    const files = publishingFixture();
    files['index.ts'] = `class Plugin { declareCapabilities() { return process.env.CAPABILITIES; } }`;
    expect(checkPublishingFiles(files).errors.join('\n')).toContain('Cannot resolve FDO capabilities');
});
test('coding context provides concrete diagnostics while excluding private files', () => {
    const files = {...publishingFixture({scripts: {test: 'node tests.js'}}), 'developer.key': 'PRIVATE_KEY_MARKER', '.env': 'SECRET_MARKER'};
    const context = buildPublishingAgentContext(Object.entries(files).map(([path, content]) => ({path: '/' + path, content})));
    expect(context).toContain('scripts');
    expect(context).toContain('advisory for generic requests');
    expect(context).not.toContain('PRIVATE_KEY_MARKER');
    expect(context).not.toContain('SECRET_MARKER');
    expect(context).toContain('No build, signature');
});


test('local preflight surfaces the registry TypeScript security findings before export', () => {
    const files = publishingFixture();
    files['index.ts'] += "\nimport test from 'node:test'; test('runtime',()=>{});";
    const report = checkPublishingFiles(files);
    expect(report.valid).toBe(false);
    expect(report.errors.join('\n')).toContain('UNAPPROVED_IMPORT');
    expect(report.errors.join('\n')).toContain('index.ts');
    expect(report.errors.join('\n')).toContain('node:test');
});

test.each([
    `defineRenderOnLoadActions({setup: () => { const node = document.querySelector('#status'); if (node) node.textContent = 'Ready'; window.createBackendReq('UI_MESSAGE', {}); }});`,
    `defineRenderOnLoadActions({handlers: {refresh: () => document.querySelector('#status')}});`,
    `defineRenderOnLoad(() => { document.getElementById('status'); window.createBackendReq('UI_MESSAGE', {}); });`,
])('local publishing accepts SDK-serialized UI callbacks: %s', source => {
    const files = publishingFixture();
    files['index.ts'] += `\nimport {defineRenderOnLoadActions, defineRenderOnLoad} from '@anikitenko/fdo-sdk';\n${source}`;
    expect(checkPublishingFiles(files).errors).toEqual([]);
});

test.each([
    `document.querySelector('body');`,
    `defineRenderOnLoadActions({setup: () => document.cookie});`,
    `defineRenderOnLoadActions({setup: () => window.fetch('https://attacker')});`,
    `defineRenderOnLoadActions({setup: (() => document.querySelector('body'))()});`,
])('local publishing keeps unsafe contexts blocked: %s', source => {
    const files = publishingFixture();
    files['index.ts'] += `\nimport {defineRenderOnLoadActions} from '@anikitenko/fdo-sdk';\n${source}`;
    const report = checkPublishingFiles(files);
    expect(report.valid).toBe(false);
    expect(report.errors.join('\n')).toMatch(/index.ts:\d+:\d+:/);
});

test('context-parameter handlers remain frontend code through TypeScript option wrappers', () => {
    const files = publishingFixture();
    files['index.ts'] += `
import {defineRenderOnLoadActions} from '@anikitenko/fdo-sdk';
defineRenderOnLoadActions(({handlers: {
    check: async ({element, document, window}) => {
        const first = document.getElementById('first');
        const second = document.querySelector('#second');
        const third = document.querySelectorAll('.third');
        await window.createBackendReq('UI_MESSAGE', {handler: 'check'});
        document.createElement('span');
        document.createTextNode('ready');
    }
}} satisfies object));`;
    expect(checkPublishingFiles(files).errors).toEqual([]);
});

test('explains how to fix non-literal capability declarations', () => {
    const files = {'package.json': JSON.stringify({name: 'my-plugin', version: '1.0.0', author: 'a', description: 'd', fdo: {compatibility: {fdo: '>=1.0.0', sdk: '^1.0.0', api: '^1.0.0'}}}), 'index.ts': 'class P { declareCapabilities() { return [process.env.CAP]; } }'};
    const text = checkPublishingFiles(files).errors.join('\n');
    expect(text).toContain('Cannot resolve FDO capabilities');
    expect(text).toContain('How to fix:');
});

test('accepts SDK helpers and constants in declareCapabilities', () => {
    const files = publishingFixture();
    files['index.ts'] = `import {createOperatorToolCapabilityPreset} from '@anikitenko/fdo-sdk';
const extra = 'system.network';
export class ReleaseConsole { declareCapabilities() { return [...createOperatorToolCapabilityPreset('git'), extra]; } }`;
    const report = checkPublishingFiles(files);
    expect(report.proposal.capabilities).toEqual(['system.process.exec', 'system.process.scope.git', 'system.network']);
});

describe('network access in the publishing check', () => {
    const entry = (capabilities) => `import * as net from 'node:net';
export class ReleaseConsole { declareCapabilities() { return ${capabilities}; } }
export const socket = net;`;
    const check = (capabilities) => {
        const files = publishingFixture();
        files['index.ts'] = entry(capabilities);
        return checkPublishingFiles(files);
    };
    test('accepts a Node network module with its transport and scope', () => {
        expect(check(`['system.network', 'system.network.tcp', 'system.network.scope.lan']`).valid).toBe(true);
    });
    test('explains which capabilities a network import needs', () => {
        const text = check(`['system.network']`).errors.join('\n');
        expect(text).toContain('requires the capabilities system.network, system.network.tcp');
        expect(text).toContain('How to fix:');
    });
    test('explains blocked non-network imports', () => {
        const files = publishingFixture();
        files['index.ts'] = `import * as fs from 'node:fs';\nexport const x = fs;\nexport class ReleaseConsole { declareCapabilities() { return []; } }`;
        expect(checkPublishingFiles(files).errors.join('\n')).toContain('SDK scope helpers');
    });
});
