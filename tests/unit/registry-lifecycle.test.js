/** @jest-environment node */
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {publishingFixture} from '../helpers/publishingFixture';
import { registryLifecycleFixture } from '../helpers/registryLifecycleFixture';
import {
    validateTrustDocument,
    validateAuthorityChain,
    fingerprint,
    keyFingerprint,
} from '../../src/utils/system/registryTrust';
import { createOfficialRegistry } from '../../src/utils/system/officialRegistry';
import { createRegistryIdentityLifecycle } from '../../src/utils/system/registryIdentity';
import { signRegistryFiles } from '../../src/utils/system/registrySigning';
import { verifyRegistryPluginDirectory } from '../../src/utils/system/registryPluginVerification';
jest.mock('../../src/utils/persistence/certificateStorage', () => ({ certificateStorage: {} }));
let fixture;
beforeAll(async () => {
    fixture = await registryLifecycleFixture();
});
function memoryStorage(initial = []) {
    const entries = new Map(initial.map((entry) => [entry.id, entry]));
    return {
        entries,
        list: () => [...entries.values()],
        put: jest.fn((entry, scope, previous) => {
            entries.set(entry.id, entry);
            if (previous && previous !== entry.id) entries.delete(previous);
        }),
        privateKey: (id) => entries.get(id)?.key,
        remove: (id) => entries.delete(id),
    };
}
test('accepts a new root only through a valid transition from the release pin', () => {
    const trust = validateTrustDocument(fixture.document(true), fixture.config);
    expect(trust.root).toBe(fixture.nextRoot);
    expect(trust.anchors).toHaveLength(2);
    expect(validateAuthorityChain(fixture.chainPem, trust).ca).toBe(false);
    const forged = fixture.document(true, { transitions: [] });
    expect(() => validateTrustDocument(forged, fixture.config)).toThrow(/not authorized/);
});
test.each(['signature', 'transition', 'rollback', 'expiry', 'revokedRoot', 'revokedIssuer'])(
    'rejects %s trust failures',
    (kind) => {
        let doc = fixture.document(true),
            previous;
        if (kind === 'signature') doc.signature = 'invalid';
        if (kind === 'transition')
            doc.payload.transitions[0] = { ...doc.payload.transitions[0], signature: 'invalid' };
        if (kind === 'rollback') previous = { sequence: 3, issuedAt: new Date().toISOString() };
        if (kind === 'expiry') doc = fixture.document(true, { expiresAt: '2020-01-01T00:00:00Z' });
        if (kind === 'revokedRoot')
            doc = fixture.document(true, {
                roots: [
                    { pem: fixture.root, status: 'revoked' },
                    { pem: fixture.nextRoot, status: 'active' },
                ],
            });
        if (kind === 'revokedIssuer') {
            doc = fixture.document(true, {
                issuers: [
                    { pem: fixture.issuer, status: 'revoked' },
                    { pem: fixture.nextIssuer, status: 'active' },
                ],
            });
            expect(() =>
                validateAuthorityChain(
                    fixture.chainPem,
                    validateTrustDocument(doc, fixture.config),
                ),
            ).toThrow(/revoked/);
            return;
        }
        expect(() => validateTrustDocument(doc, fixture.config, previous)).toThrow();
    },
);
test('refreshes trust after five minutes and never accepts a rolled back document after restart', async () => {
    const storage = memoryStorage();
    let clock = Date.now(),
        doc = fixture.document();
    const fetchCertificate = jest.fn(async () => new Response(JSON.stringify(doc)));
    let registry = createOfficialRegistry({
        config: fixture.config,
        storage,
        fetchCertificate,
        now: () => clock,
    });
    await registry.ensureAnchor();
    clock += 301000;
    doc = fixture.document(true);
    await registry.ensureAnchor();
    expect(fetchCertificate).toHaveBeenCalledTimes(2);
    doc = fixture.document();
    registry = createOfficialRegistry({
        config: fixture.config,
        storage,
        fetchCertificate,
        now: () => clock,
    });
    await expect(registry.ensureAnchor()).rejects.toThrow(/rolled back/);
});
test('status lookup fails closed on revoked certificates and registry outages', async () => {
    const storage = memoryStorage();
    const fetchCertificate = jest.fn(
        async (url) =>
            new Response(
                JSON.stringify(
                    url.endsWith('/trust')
                        ? fixture.document()
                        : { fingerprint: keyFingerprint(fixture.leaf), status: 'revoked' },
                ),
            ),
    );
    const registry = createOfficialRegistry({ config: fixture.config, storage, fetchCertificate });
    await expect(registry.certificateStatus(keyFingerprint(fixture.leaf))).rejects.toThrow(
        /revoked/,
    );
    fetchCertificate.mockRejectedValue(new Error('offline'));
    await expect(registry.certificateStatus(keyFingerprint(fixture.leaf))).rejects.toThrow(
        'offline',
    );
});
test('persists a renewal key before sending the request and recovers a lost response without losing either key', async () => {
    const old = {
        id: fingerprint(fixture.leaf),
        label: 'Developer',
        cert: fixture.leaf,
        key: fixture.key,
        chainPem: fixture.chainPem,
        kind: 'developer',
    };
    const storage = memoryStorage([old]);
    let issued;
    const registry = {
        trust: async () => validateTrustDocument(fixture.document(), fixture.config),
        ensureAnchor: async () => ({ id: fingerprint(fixture.root) }),
        certificateStatus: jest.fn(async (id) => {
            if (id === keyFingerprint(fixture.leaf))
                return { status: 'active', developerSub: 'owner' };
            if (issued && issued.fingerprint === id) return issued;
            throw Object.assign(new Error('not found'), { status: 404 });
        }),
        renewIdentity: jest.fn(async (payload) => {
            expect(
                storage.list().some((entry) => entry.kind === 'renewal-pending' && entry.key),
            ).toBe(true);
            issued = await fixture.issueDeveloper(payload.publicKeyPem);
            throw new Error('response lost');
        }),
    };
    const lifecycle = createRegistryIdentityLifecycle({ registry, storage });
    await expect(lifecycle.ensureIdentity(old)).rejects.toThrow('response lost');
    expect(storage.privateKey(old.id)).toBe(fixture.key);
    const renewed = await lifecycle.ensureIdentity(old);
    expect(renewed.id).not.toBe(old.id);
    expect(storage.privateKey(renewed.id)).toContain('PRIVATE KEY');
    expect(storage.entries.has(old.id)).toBe(false);
    expect(storage.list().some((entry) => entry.kind === 'renewal-pending')).toBe(false);
    expect(registry.renewIdentity).toHaveBeenCalledTimes(1);
});
test('a revoked developer identity cannot renew by possession of its old private key', async () => {
    const old = {
        id: fingerprint(fixture.leaf),
        cert: fixture.leaf,
        key: fixture.key,
        chainPem: fixture.chainPem,
    };
    const registry = {
        trust: async () => validateTrustDocument(fixture.document(), fixture.config),
        certificateStatus: async () => {
            throw new Error('revoked');
        },
        renewIdentity: jest.fn(),
    };
    await expect(
        createRegistryIdentityLifecycle({ registry, storage: memoryStorage([old]) }).ensureIdentity(
            old,
        ),
    ).rejects.toThrow('revoked');
    expect(registry.renewIdentity).not.toHaveBeenCalled();
});
test('checks published identity, current status, signature and every source digest at runtime', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'registry-plugin-'));
    try {
        const files = publishingFixture({name:'owned-plugin'});
        const signed = signRegistryFiles(files, fixture.chainPem, fixture.key, fixture.root),
            metadata = JSON.parse(signed['fdo.meta.json']);
        for (const [name, bytes] of Object.entries(signed))
            await fs.writeFile(path.join(dir, name), bytes);
        const registry = {
            releaseStatus: jest.fn(async () => ({
                status: 'active',
                signerFingerprint: keyFingerprint(fixture.leaf),
                certificatePem: fixture.leaf,
                signingMetadata: metadata,
            })),
        };
        expect(
            (await verifyRegistryPluginDirectory(dir, metadata, signed['fdo.signature'], registry))
                .success,
        ).toBe(true);
        await fs.writeFile(path.join(dir, 'index.ts'), 'tampered');
        await expect(
            verifyRegistryPluginDirectory(dir, metadata, signed['fdo.signature'], registry),
        ).rejects.toThrow(/modified/);
        await fs.writeFile(path.join(dir, 'index.ts'), files['index.ts']);
        await fs.writeFile(path.join(dir, 'extra.ts'), 'unsigned');
        await expect(
            verifyRegistryPluginDirectory(dir, metadata, signed['fdo.signature'], registry),
        ).rejects.toThrow(/unsigned/);
        await fs.rm(path.join(dir, 'extra.ts'));
        registry.releaseStatus.mockRejectedValue(new Error('release revoked'));
        await expect(
            verifyRegistryPluginDirectory(dir, metadata, signed['fdo.signature'], registry),
        ).rejects.toThrow(/revoked/);
    } finally {
        await fs.rm(dir, { recursive: true, force: true });
    }
});

test('binds an active certificate or release to the exact leaf in its validated chain',async()=>{
    const storage=memoryStorage();
    const fetchCertificate=jest.fn(async url=>new Response(JSON.stringify(url.endsWith('/trust')?fixture.document():{fingerprint:keyFingerprint(fixture.nextRoot),pluginId:'owned-plugin',version:'1.0.0',status:'active',certificatePem:fixture.nextRoot,certificateChainPem:fixture.chainPem})));
    const registry=createOfficialRegistry({config:fixture.config,storage,fetchCertificate});
    await expect(registry.certificateStatus(keyFingerprint(fixture.nextRoot))).rejects.toThrow(/does not match its validated chain/);
    await expect(registry.releaseStatus('owned-plugin','1.0.0')).rejects.toThrow(/does not match its validated chain/);
});

test('requires a fresh nonce-bound issuer signature for an active certificate status',async()=>{
    const status={fingerprint:keyFingerprint(fixture.leaf),status:'active',certificatePem:fixture.leaf,certificateChainPem:fixture.chainPem};
    let captured;
    const fetchCertificate=jest.fn(async url=>{
        const parsed=new URL(url);
        if(parsed.pathname.endsWith('/trust'))return new Response(JSON.stringify(fixture.document()));
        captured=fixture.statusProof(status,parsed.searchParams.get('nonce'),'certificate');return new Response(JSON.stringify(captured));
    });
    const registry=createOfficialRegistry({config:fixture.config,storage:memoryStorage(),fetchCertificate});
    expect((await registry.certificateStatus(status.fingerprint)).status).toBe('active');
    fetchCertificate.mockImplementation(async()=>new Response(JSON.stringify(captured)));
    await expect(registry.certificateStatus(status.fingerprint)).rejects.toThrow(/proof/);
});
test.each(['signature','result','expiry','purpose'])('rejects an active status with invalid %s evidence',async(kind)=>{
    const status={fingerprint:keyFingerprint(fixture.leaf),status:'active',certificatePem:fixture.leaf,certificateChainPem:fixture.chainPem};
    const fetchCertificate=async url=>{
        const parsed=new URL(url);if(parsed.pathname.endsWith('/trust'))return new Response(JSON.stringify(fixture.document()));
        const signed=fixture.statusProof(status,parsed.searchParams.get('nonce'),kind==='purpose'?'release':'certificate',kind==='expiry'?{expiresAt:'2020-01-01T00:00:00Z'}:{});
        if(kind==='signature')signed.proof.signature='invalid';if(kind==='result')signed.extra='tampered';return new Response(JSON.stringify(signed));
    };
    await expect(createOfficialRegistry({config:fixture.config,storage:memoryStorage(),fetchCertificate}).certificateStatus(status.fingerprint)).rejects.toThrow();
});
test('manual release requests and developer status return explicit revocation outcomes',async()=>{
    const fetchCertificate=jest.fn(async address=>{
        const url=new URL(address);
        if(url.pathname.endsWith('/trust'))return new Response(JSON.stringify(fixture.document()));
        const certificate=url.pathname.includes('/certificates/');
        const result=certificate?{fingerprint:keyFingerprint(fixture.leaf),status:'revoked'}:{pluginId:'owned-plugin',version:'1.0.0',status:'revoked'};
        return new Response(JSON.stringify(fixture.statusProof(result,url.searchParams.get('nonce'),certificate?'certificate':'release')));
    });
    const registry=createOfficialRegistry({config:fixture.config,storage:memoryStorage(),fetchCertificate});
    await expect(registry.releaseStatus('owned-plugin','1.0.0')).rejects.toMatchObject({code:'REGISTRY_RELEASE_INACTIVE'});
    await expect(registry.certificateStatus(keyFingerprint(fixture.leaf))).rejects.toMatchObject({code:'REGISTRY_CERTIFICATE_INACTIVE',lifecycleStatus:'revoked'});
    expect(fetchCertificate.mock.calls.some(([address])=>String(address).includes('/packages/'))).toBe(false);
});
