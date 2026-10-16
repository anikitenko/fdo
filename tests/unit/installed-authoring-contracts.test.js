/** @jest-environment node */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {readInstalledAuthoringContracts, installedSdkKnowledgeIdentity} from '../../src/utils/sdk/installedAuthoringContracts';
import {getCachedFdoSdkKnowledgeIndex} from '../../src/utils/sdk/installedSdkKnowledge';
jest.mock('electron', () => ({app: {isPackaged: false}}));

test('reads and schema-validates the installed SDK public contracts and indexes them for coding evidence', () => {
    const result = readInstalledAuthoringContracts(path.resolve('node_modules/@anikitenko/fdo-sdk'));
    expect(result.contracts.dom).toMatchObject({status: 'supported', version: '1.0.0'});
    expect(result.contracts.components).toMatchObject({status: 'supported', version: '1.2.0'});
    expect(result.contracts.components.data.components.map(item => item.identity)).toEqual(expect.arrayContaining(['fdo.dialog', 'fdo.confirmation-dialog', 'fdo.popover']));
    expect(result.contracts.previews).toMatchObject({status:'supported',version:'1.0.0'});
    const index = getCachedFdoSdkKnowledgeIndex();
    expect(index.some(item => item.path === 'dist/dom-authoring-contract.json')).toBe(true);
    expect(index.some(item => item.path === 'dist/ui-components.json')).toBe(true);
    expect(index.some(item => item.path === 'dist/ui-previews.json')).toBe(true);
    expect(index.some(item => /AUTHORING_COMPONENTS/.test(item.path))).toBe(true);
    expect(index.some(item => /AUTHORING_COMPATIBILITY/.test(item.path))).toBe(true);
    expect(getCachedFdoSdkKnowledgeIndex()).toBe(index);
});

test('rejects unsupported majors, malformed contracts and version mismatches; legacy packages remain usable', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fdo-authoring-contract-'));
    const write = (name, data) => fs.writeFileSync(path.join(root, name), JSON.stringify(data));
    try {
        const manifest = {name: '@anikitenko/fdo-sdk', version: '1.6.0', exports: {
            './dom-authoring-contract.json': './dom.json', './dom-authoring-contract.schema.json': './schema.json'}};
        write('package.json', manifest);
        write('schema.json', {type: 'object', required: ['contractVersion', 'sdkVersion', 'classes'], properties: {classes: {type: 'array'}}});
        write('dom.json', {contractVersion: '2.0.0', sdkVersion: '1.6.0', classes: []});
        expect(readInstalledAuthoringContracts(root).contracts.dom).toMatchObject({status: 'unsupported'});
        write('dom.json', {contractVersion: '1.0.0', sdkVersion: '1.6.0'});
        expect(readInstalledAuthoringContracts(root).contracts.dom.status).toBe('invalid');
        write('dom.json', {contractVersion: '1.0.0', sdkVersion: '1.5.2', classes: []});
        expect(readInstalledAuthoringContracts(root).contracts.dom.message).toContain('version differs');
        write('dom.json', {contractVersion: '1.1.0', sdkVersion: '1.6.0', classes: [], extra: 'additive'});
        expect(readInstalledAuthoringContracts(root).contracts.dom.status).toBe('supported');
        const before = installedSdkKnowledgeIdentity(root, path.join(root, 'dist'));
        write('package.json', {...manifest, version: '1.6.1'});
        expect(installedSdkKnowledgeIdentity(root, path.join(root, 'dist'))).not.toBe(before);
        write('package.json', {name: '@anikitenko/fdo-sdk', version: '1.5.2'});
        expect(readInstalledAuthoringContracts(root).contracts).toEqual({dom: {status: 'absent'}, components: {status: 'absent'}, previews:{status:'absent'}});
    } finally {fs.rmSync(root, {recursive: true, force: true});}
});
