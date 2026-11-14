import 'reflect-metadata';
import crypto from 'node:crypto';
import { X509CertificateGenerator } from '@peculiar/x509';
import { officialRegistry } from './officialRegistry';
import { certificateStorage } from '../persistence/certificateStorage';
import { stableStringify, validateRegistryIdentity } from './registrySigning';
import { keyFingerprint, validateAuthorityChain } from './registryTrust';

export function createRegistryIdentityLifecycle({
    registry = officialRegistry,
    storage = certificateStorage,
    now = () => Date.now(),
} = {}) {
    const pending = new Map();
    async function current(entry) {
        const trust = await registry.trust();
        let staged = storage
            .list('registry')
            .find((item) => item.kind === 'renewal-pending' && item.previousId === entry.id);
        async function finish(status) {
            const key = storage.privateKey(staged.id, 'registry');
            const cert = validateRegistryIdentity(status.certificateChainPem, key, trust.anchors);
            if (keyFingerprint(cert.toString()) !== staged.publicKeyFingerprint)
                throw new Error('Renewal returned an unexpected signing key.');
            const result = {
                id: cert.fingerprint256,
                label: entry.label,
                cert: cert.toString(),
                key,
                kind: 'developer',
                chainPem: status.certificateChainPem,
                anchorId: (await registry.ensureAnchor()).id,
                createdAt: new Date(now()).toISOString(),
                expiresAt: new Date(cert.validTo).toISOString(),
                imported: true,
            };
            storage.put(result, 'registry', entry.id);
            storage.remove(staged.id, 'registry');
            const { key: ignored, ...publicResult } = result;
            return publicResult;
        }
        if (staged) {
            try {
                return await finish(await registry.certificateStatus(staged.publicKeyFingerprint));
            } catch (error) {
                if (error.status !== 404) throw error;
            }
        }
        const old = new crypto.X509Certificate(entry.cert),
            oldId = keyFingerprint(entry.cert);
        const status = await registry.certificateStatus(oldId);
        // A revoked/expired identity never renews by possession alone. Account recovery is explicit.
        validateAuthorityChain(entry.chainPem, trust);
        if (!staged && Date.parse(old.validTo) - now() > 30 * 86400000) return entry;
        if (!staged) {
            const algorithm = {
                name: 'RSASSA-PKCS1-v1_5',
                hash: 'SHA-256',
                modulusLength: 3072,
                publicExponent: new Uint8Array([1, 0, 1]),
            };
            const keys = await crypto.webcrypto.subtle.generateKey(algorithm, true, [
                'sign',
                'verify',
            ]);
            const cert = await X509CertificateGenerator.createSelfSigned(
                {
                    name: 'CN=Pending FDO developer renewal',
                    serialNumber: crypto.randomBytes(16).toString('hex'),
                    notBefore: new Date(now() - 60000),
                    notAfter: new Date(now() + 86400000),
                    keys,
                    signingAlgorithm: algorithm,
                },
                crypto.webcrypto,
            );
            const key = crypto
                .createPrivateKey({
                    key: Buffer.from(
                        await crypto.webcrypto.subtle.exportKey('pkcs8', keys.privateKey),
                    ),
                    format: 'der',
                    type: 'pkcs8',
                })
                .export({ format: 'pem', type: 'pkcs8' });
            staged = {
                id: new crypto.X509Certificate(cert.toString('pem')).fingerprint256,
                label: 'Pending registry renewal',
                cert: cert.toString('pem'),
                key,
                kind: 'renewal-pending',
                previousId: entry.id,
                publicKeyFingerprint: keyFingerprint(cert.toString('pem')),
            };
            // Persist the new key with OS protection before sending a renewal that can succeed remotely.
            storage.put(staged, 'registry');
        }
        const key = storage.privateKey(staged.id, 'registry'),
            publicKeyPem = crypto
                .createPublicKey(key)
                .export({ type: 'spki', format: 'pem' })
                .toString();
        const proofOfPossession = crypto
            .sign(
                'sha256',
                Buffer.from(`${status.developerSub}\n${staged.publicKeyFingerprint}`),
                key,
            )
            .toString('base64');
        const payload = {
            format: 'fdo-developer-renewal-v1',
            previousFingerprint: oldId,
            publicKeyPem,
            proofOfPossession,
            nonce: crypto.randomBytes(32).toString('hex'),
            issuedAt: new Date(now()).toISOString(),
        };
        const signature = crypto
            .sign(
                'sha256',
                Buffer.from(stableStringify(payload)),
                storage.privateKey(entry.id, 'registry'),
            )
            .toString('base64');
        await registry.renewIdentity({ ...payload, signature });
        return finish(await registry.certificateStatus(staged.publicKeyFingerprint));
    }
    return {
        ensureIdentity(entry) {
            if (!pending.has(entry.id))
                pending.set(
                    entry.id,
                    current(entry).finally(() => pending.delete(entry.id)),
                );
            return pending.get(entry.id);
        },
    };
}
export const registryIdentityLifecycle = createRegistryIdentityLifecycle();
