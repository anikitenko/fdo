/** @jest-environment node */
import {dump} from 'js-yaml';
import {validateCollection, validateRepository} from '../../src/utils/gitops/manifest';

export const collection = () => ({
    apiVersion: 'fdo.dev/v1alpha1', kind: 'PluginCollection',
    metadata: {name: 'azure-devops', displayName: 'Azure DevOps Toolkit', description: 'Essential Azure DevOps plugins', version: '1.2.0', maintainers: [{github: 'alexvwan'}]},
    spec: {plugins: [
        {name: 'azure-resources', repository: 'https://github.com/acme/fdo-azure-resources', targetRevision: 'v1.3.0', path: '/'},
        {name: 'azure-cost-analyzer', repository: 'https://github.com/acme/fdo-azure-cost', targetRevision: 'main', path: '/plugin'},
        {name: 'azure-pipelines', repository: 'https://github.com/acme/fdo-azure-pipelines', targetRevision: 'v2.1.0', path: '/'},
    ]},
});
const config = () => ({url: 'https://github.com/acme/collection', authType: 'none', manifestPath: 'collections/azure.yaml', revisionType: 'branch', targetRevision: 'main'});

test('accepts the proposed PluginCollection YAML including root and nested plugin paths', () => {
    expect(validateCollection(dump(collection()))).toEqual(collection());
});
test.each([
    ['apiVersion', manifest => {manifest.apiVersion = 'other/v1';}],
    ['kind', manifest => {manifest.kind = 'Plugin';}],
    ['unknown fields', manifest => {manifest.spec.plugin = [];}],
    ['missing version', manifest => {delete manifest.metadata.version;}],
    ['invalid version', manifest => {manifest.metadata.version = 'latest';}],
    ['invalid maintainer', manifest => {manifest.metadata.maintainers = [{github: '../user'}];}],
    ['empty plugins', manifest => {manifest.spec.plugins = [];}],
    ['duplicate names', manifest => {manifest.spec.plugins[1].name = manifest.spec.plugins[0].name;}],
    ['embedded credentials', manifest => {manifest.spec.plugins[0].repository = 'https://user:secret@github.com/acme/repo';}],
    ['path traversal', manifest => {manifest.spec.plugins[0].path = '/plugin/../secret';}],
    ['missing revision', manifest => {delete manifest.spec.plugins[0].targetRevision;}],
    ['shell-like ref', manifest => {manifest.spec.plugins[0].targetRevision = '--upload-pack=command';}],
])('rejects %s', (_label, mutate) => {
    const manifest = collection(); mutate(manifest);
    expect(() => validateCollection(dump(manifest))).toThrow();
});
test.each(['kind: [', 'kind: PluginCollection\nkind: Other', '---\nkind: PluginCollection\n---\nkind: Other', 'x'.repeat(262145)])('rejects malformed, duplicate, multiple or oversized YAML', source => {
    expect(() => validateCollection(source)).toThrow();
});
// noinspection HttpUrlsUsage -- Insecure URLs are intentional rejection fixtures.
test.each([
    {url: 'http://github.com/acme/repo'}, {url: 'file:///tmp/repo'}, {url: 'https://github.com/acme/repo?token=secret'},
    {manifestPath: '../manifest.yaml'}, {manifestPath: '/manifest.yaml'}, {manifestPath: 'x\\manifest.yaml'},
    {targetRevision: 'main~1'}, {targetRevision: 'main..next'}, {targetRevision: '-option'}, {revisionType: 'release'},
    {authType: 'basic', username: 'user', password: ''}, {authType: 'basic', username: 'user:name', password: 'secret'},
])('rejects unsafe repository input %j', patch => {
    expect(() => validateRepository({...config(), ...patch})).toThrow();
});
test('accepts independent token authentication, slash branches and release tags', () => {
    expect(validateRepository({...config(), authType: 'basic', username: 'alice', password: 'secret', targetRevision: 'feature/tools'}).targetRevision).toBe('feature/tools');
    expect(validateRepository({...config(), revisionType: 'tag', targetRevision: 'v1.3.0'}).revisionType).toBe('tag');
});

test.each(['01.2.3', '1.2.3-01', '1.2.3-..', '1.2.3+build..1'])('rejects invalid semantic version %s', value => {
    const manifest = collection(); manifest.metadata.version = value;
    expect(() => validateCollection(dump(manifest))).toThrow('semantic version');
});

test('accepts semantic prerelease and build versions', () => {
    const manifest = collection(); manifest.metadata.version = '1.2.3-alpha.1+build.01';
    expect(validateCollection(dump(manifest)).metadata.version).toBe(manifest.metadata.version);
});
