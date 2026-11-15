/** @jest-environment node */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {createOrganizationRegistries, normalizeOrganizationRegistry, organizationRegistries} from '../../src/utils/system/organizationRegistries';
import {createOfficialRegistry} from '../../src/utils/system/officialRegistry';
import {certificateStorage} from '../../src/utils/persistence/certificateStorage';
import {importDeveloperCertificateFiles} from '../../src/utils/system/certificateImports';
import {Certs} from '../../src/utils/system/certs';
import {createRegistryArchive} from '../../src/utils/plugins/publishing/registryArchive';
import {registryLifecycleFixture} from '../helpers/registryLifecycleFixture';
import {publishingFixture} from '../helpers/publishingFixture';
import {keyFingerprint, fingerprint} from '../../src/utils/system/registryTrust';
import {signRegistryFiles} from '../../src/utils/system/registrySigning';
import {registryCertificateStatus} from '../../src/ipc/registryCertificates';
import {startRegistryLifecycleMonitor} from '../../src/utils/system/registryLifecycleMonitor';
import configuration from '../../src/config/officialRegistry.json';

jest.mock('../../src/utils/persistence/store', () => ({settings: {}}));
jest.mock('../../src/utils/persistence/certificateStorage', () => ({certificateStorage: {}}));
jest.mock('../../src/utils/desktop/NotificationCenter', () => ({NotificationCenter: {addNotification: jest.fn()}}));
jest.mock('../../src/utils/filesystem/safeReadFileSync', () => ({safeReadFileSync: (...args) => require('node:fs').readFileSync(...args)}));
jest.mock('electron', () => ({ipcMain: {handle: jest.fn()}}));

let fixture, otherFixture, manager, store, storage, directory, fetchCertificate, statuses, document, release, offline;
const input = (patch = {}) => ({name: 'Acme', url: 'https://plugins.acme.test', rootFingerprint256: fingerprint(fixture.root), ...patch});
beforeAll(async () => {fixture = await registryLifecycleFixture(); otherFixture = await registryLifecycleFixture();});
beforeEach(async () => {
    const entries = new Map();
    storage = {
        list: jest.fn(scope => [...entries.values()].filter(entry => !scope || entry.scope === scope).map(({key, ...entry}) => ({...entry, hasPrivateKey: !!key}))),
        put: jest.fn((entry, scope, previous) => {entries.set(`${scope}:${entry.id}`, {...entry, scope}); if (previous && previous !== entry.id) entries.delete(`${scope}:${previous}`);}),
        remove: jest.fn((id, scope) => entries.delete(`${scope}:${id}`)),
        privateKey: jest.fn((id, scope) => entries.get(`${scope}:${id}`)?.key),
        update: jest.fn((id, patch, scope) => {const entry = entries.get(`${scope}:${id}`); if (entry) entries.set(`${scope}:${id}`, {...entry, ...patch});}),
    };
    Object.assign(certificateStorage, storage);
    const saved = new Map();
    store = {get: key => structuredClone(saved.get(key)), set: jest.fn((key, value) => saved.set(key, structuredClone(value)))};
    statuses = new Map([[keyFingerprint(fixture.leaf), {fingerprint: keyFingerprint(fixture.leaf), status: 'active', developerSub: 'owner', certificatePem: fixture.leaf, certificateChainPem: fixture.chainPem}]]);
    document = fixture.document(); offline = false; release = undefined;
    fetchCertificate = jest.fn(async (address, options) => {
        if (offline) throw new Error('network offline');
        const url = new URL(address);
        if (url.pathname.endsWith('/trust')) return new Response(JSON.stringify(document));
        if (url.pathname.endsWith('/renew')) {
            const result = await fixture.issueDeveloper(JSON.parse(options.body).publicKeyPem);
            statuses.set(result.fingerprint, result);
            return new Response(JSON.stringify(result));
        }
        if (url.pathname.startsWith('/api/v1/certificates/')) {
            const status = statuses.get(url.pathname.split('/').pop());
            if (!status) return new Response('{}', {status: 404});
            return new Response(JSON.stringify(fixture.statusProof(status, url.searchParams.get('nonce'), 'certificate')));
        }
        if (url.pathname.includes('/releases/')) return new Response(JSON.stringify(fixture.statusProof(release, url.searchParams.get('nonce'), 'release')));
        throw new Error(`Unexpected registry route: ${url.pathname}`);
    });
    manager = createOrganizationRegistries({store, storage, createClient: options => createOfficialRegistry({...options, fetchCertificate})});
    jest.spyOn(organizationRegistries, 'get').mockImplementation(id => manager.get(id));
    jest.spyOn(organizationRegistries, 'forCertificate').mockImplementation(entry => manager.forCertificate(entry));
    jest.spyOn(organizationRegistries, 'forOrigin').mockImplementation(origin => manager.forOrigin(origin));
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'fdo-organization-'));
});
afterEach(async () => {jest.restoreAllMocks(); await fs.rm(directory, {recursive: true, force: true});});

test.each([
    {url: 'http://plugins.acme.test'}, {url: 'https://user:secret@plugins.acme.test'}, {url: 'https://plugins.acme.test/path'},
    {url: 'https://plugins.acme.test?token=secret'}, {url: 'https://plugins.acme.test#fragment'}, {url: 'file:///tmp/registry'},
    {url: 'https://plugins.fdo.alexvwan.me'}, {name: ''}, {name: 'bad\nname'}, {rootFingerprint256: 'untrusted'},
])('rejects invalid connection configuration %j before making requests', async patch => {
    await expect(manager.add(input(patch))).rejects.toThrow();
    expect(fetchCertificate).not.toHaveBeenCalled();
    expect(store.set).not.toHaveBeenCalled();
});
test('normalizes public pins and generates the same connection ID for every developer', () => {
    const expected = normalizeOrganizationRegistry(input());
    expect(normalizeOrganizationRegistry(input({name: ' Team ', url: 'https://PLUGINS.acme.test:443/', rootFingerprint256: new crypto.X509Certificate(fixture.root).fingerprint256})))
        .toEqual({...expected, name: 'Team'});
});
test('private registries work independently of an unconfigured official registry', async () => {
    const previous = configuration.certificateUrl;
    configuration.certificateUrl = '';
    try {expect(await manager.add(input())).toMatchObject({url: 'https://plugins.acme.test'});}
    finally {configuration.certificateUrl = previous;}
});
test('verifies the root pin before persisting trust and rejects duplicate connections', async () => {
    await expect(manager.add(input({rootFingerprint256: '0'.repeat(64)}))).rejects.toThrow(/root replacement/);
    expect(manager.list()).toEqual([]);
    expect(storage.put).not.toHaveBeenCalled();
    const connection = await manager.add(input());
    expect(manager.list()).toEqual([connection]);
    await expect(manager.add(input())).rejects.toThrow(/already connected/);
});
test('isolates anchors and developer identities even when organizations use the same CA', async () => {
    const first = await manager.add(input());
    const second = await manager.add(input({url: 'https://other.acme.test', name: 'Other'}));
    const file = path.join(directory, 'developer.pem');
    await fs.writeFile(file, fixture.key + '\n' + fixture.chainPem);
    await importDeveloperCertificateFiles([file], first.id);
    await importDeveloperCertificateFiles([file], second.id);
    const developers = storage.list('org').filter(entry => entry.kind === 'developer');
    expect(developers).toHaveLength(2);
    expect(new Set(developers.map(entry => entry.id)).size).toBe(2);
    expect(storage.list('registry')).toEqual([]);
    expect(developers.every(entry => entry.hasPrivateKey && !('key' in entry))).toBe(true);
    manager.remove(first.id);
    expect(storage.list('org').every(entry => entry.registryId === second.id)).toBe(true);
    expect(manager.get(second.id).registry).toBeDefined();
});
test('requires a chain issued by this organization before storing any signing key', async () => {
    const connection = await manager.add(input());
    const file = path.join(directory, 'wrong-developer.pem');
    await fs.writeFile(file, otherFixture.key + '\n' + otherFixture.chainPem);
    await expect(importDeveloperCertificateFiles([file], connection.id)).rejects.toThrow();
    expect(storage.list('org').some(entry => entry.hasPrivateKey)).toBe(false);
});
async function importIdentity() {
    const connection = await manager.add(input());
    const file = path.join(directory, 'developer.pem');
    await fs.writeFile(file, fixture.chainPem + '\n' + fixture.key);
    await importDeveloperCertificateFiles([file], connection.id);
    return {connection, entry: storage.list('org').find(item => item.kind === 'developer')};
}
test('renews with the shared protected-key lifecycle and never uses official storage or endpoints', async () => {
    const {connection, entry} = await importIdentity();
    const renewed = await manager.get(connection.id).lifecycle.ensureIdentity(entry);
    expect(renewed).toMatchObject({scope: 'org', registryId: connection.id, hasPrivateKey: true});
    expect(renewed.id).not.toBe(entry.id);
    expect(storage.list('org').some(item => item.id === entry.id || item.kind === 'renewal-pending')).toBe(false);
    expect(storage.put.mock.calls.every(([, scope]) => scope === 'org')).toBe(true);
    expect(storage.privateKey.mock.calls.every(([, scope]) => scope === 'org')).toBe(true);
    expect(fetchCertificate.mock.calls.every(([url]) => new URL(url).origin === connection.url)).toBe(true);
});
test('keeps offline identities visible with signing blocked and does not invent revocation', async () => {
    const {connection} = await importIdentity();
    offline = true;
    const result = await registryCertificateStatus(manager.get(connection.id));
    expect(result.developers).toHaveLength(1);
    expect(result.developers[0]).toMatchObject({lifecycleStatus: 'unavailable'});
    await expect(manager.get(connection.id).lifecycle.ensureIdentity(result.developers[0])).rejects.toThrow();
});
test('revocation blocks organization signing despite a future certificate expiry', async () => {
    const {connection, entry} = await importIdentity();
    statuses.get(keyFingerprint(entry.cert)).status = 'revoked';
    const result = await registryCertificateStatus(manager.get(connection.id));
    expect(result.developers[0]).toMatchObject({lifecycleStatus: 'revoked'});
    expect(await Certs.signWithCertificate(directory, `organization:${entry.id}`)).toMatchObject({success: false, error: expect.stringContaining('revoked')});
    expect(storage.privateKey).not.toHaveBeenCalled();
});
test('uses the shared archive and local signers for organization selectors and rechecks status on verification', async () => {
    const {entry} = await importIdentity();
    for (const [name, content] of Object.entries(publishingFixture())) await fs.writeFile(path.join(directory, name), content);
    const archive = await createRegistryArchive(directory, `organization:${entry.id}`);
    expect(archive).toMatchObject({scope: 'org', archive: expect.any(Buffer)});
    const renewed = storage.list('org').find(item => item.kind === 'developer');
    expect(await Certs.signWithCertificate(directory, `organization:${renewed.id}`)).toEqual({success: true});
    expect(await Certs.verifyPlugin(directory)).toMatchObject({success: true, registry: true, signer: {registryId: entry.registryId}});
    offline = true;
    expect(await Certs.verifyPlugin(directory)).toMatchObject({success: false});
});
test('verifies published plugins with their host-recorded origin and blocks disconnected connections', async () => {
    const connection = await manager.add(input());
    const signed = signRegistryFiles(publishingFixture(), fixture.chainPem, fixture.key, fixture.root);
    const metadata = JSON.parse(signed['fdo.meta.json']);
    release = {pluginId: JSON.parse(publishingFixture()['package.json']).name, version: '1.0.0', status: 'active',
        signerFingerprint: keyFingerprint(fixture.leaf), certificatePem: fixture.leaf, certificateChainPem: fixture.chainPem, signingMetadata: metadata};
    for (const [name, content] of Object.entries(signed)) await fs.writeFile(path.join(directory, name), content);
    expect(await Certs.verifyPlugin(directory, {registryOrigin: connection.url})).toMatchObject({success: true, registry: true});
    manager.remove(connection.id);
    expect(await Certs.verifyPlugin(directory, {registryOrigin: connection.url})).toMatchObject({success: false, error: expect.stringContaining('no longer trusted')});
});
test('invalidates cached clients on disconnect and rejects trust rollback after restart', async () => {
    const connection = await manager.add(input());
    document = fixture.document(false, {sequence: 3});
    const context = manager.get(connection.id);
    await context.registry.trust();
    document = fixture.document(false, {sequence: 2});
    const restarted = createOrganizationRegistries({store, storage, createClient: options => createOfficialRegistry({...options, fetchCertificate})});
    await expect(restarted.get(connection.id).registry.trust()).rejects.toThrow(/rolled back/);
    manager.remove(connection.id);
    await expect(context.registry.ensureAnchor()).rejects.toThrow(/removed or changed/);
    expect(storage.list('org')).toEqual([]);
});
test('disconnecting during a remote renewal cannot recreate removed identities or pending keys', async () => {
    const {connection, entry} = await importIdentity();
    const original = fetchCertificate.getMockImplementation();
    fetchCertificate.mockImplementation(async (url, options) => {
        const result = await original(url, options);
        if (new URL(url).pathname.endsWith('/renew')) manager.remove(connection.id);
        return result;
    });
    await expect(manager.get(connection.id).lifecycle.ensureIdentity(entry)).rejects.toThrow(/removed or changed/);
    expect(storage.list('org')).toEqual([]);
});
test('deleting an identity during its status check cannot resurrect it through renewal', async () => {
    const {connection, entry} = await importIdentity();
    const original = fetchCertificate.getMockImplementation();
    fetchCertificate.mockImplementation(async (url, options) => {
        const result = await original(url, options);
        if (new URL(url).pathname.includes('/certificates/')) storage.remove(entry.id, 'org');
        return result;
    });
    await expect(manager.get(connection.id).lifecycle.ensureIdentity(entry)).rejects.toThrow(/certificate was removed/);
    expect(storage.list('org').some(item => item.hasPrivateKey)).toBe(false);
    expect(fetchCertificate.mock.calls.some(([url]) => new URL(url).pathname.endsWith('/renew'))).toBe(false);
});
test('startup monitoring checks each organization independently when the official registry is offline', async () => {
    const first = {id: 'first', kind: 'developer', registryId: 'acme'};
    const second = {id: 'second', kind: 'developer', registryId: 'other'};
    const lifecycle = {ensureIdentity: jest.fn(async () => {})};
    let complete;
    const done = new Promise(resolve => {complete = resolve;});
    lifecycle.ensureIdentity.mockImplementation(async entry => {expect(entry).toEqual(first); complete();});
    const onError = jest.fn();
    const stop = startRegistryLifecycleMonitor({
        registry: {configured: () => true, ensureAnchor: async () => {throw new Error('official offline');}},
        storage: {list: scope => scope === 'org' ? [first, second] : []}, onError,
        organizations: {list: () => [{id: 'acme'}], get: () => ({scope: 'org', connection: {id: 'acme'}, lifecycle, registry: {configured: () => true, ensureAnchor: async () => {}}})},
    });
    try {await done; expect(onError).toHaveBeenCalledWith(expect.objectContaining({message: 'official offline'}), undefined);}
    finally {stop();}
});
