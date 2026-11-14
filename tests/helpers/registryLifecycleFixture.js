import 'reflect-metadata';
import crypto from 'node:crypto';
import {
    X509CertificateGenerator,
    BasicConstraintsExtension,
    KeyUsagesExtension,
    KeyUsageFlags,
    ExtendedKeyUsageExtension,
} from '@peculiar/x509';
import { stableStringify } from '../../src/utils/system/registrySigning';
import { fingerprint, keyFingerprint } from '../../src/utils/system/registryTrust';
export async function registryLifecycleFixture() {
    const algorithm = {
        name: 'RSASSA-PKCS1-v1_5',
        hash: 'SHA-256',
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
    };
    const keys = await Promise.all(
        [0, 1, 2, 3, 4].map(() =>
            crypto.webcrypto.subtle.generateKey(algorithm, true, ['sign', 'verify']),
        ),
    );
    const privatePem = async (pair) =>
        crypto
            .createPrivateKey({
                key: Buffer.from(await crypto.webcrypto.subtle.exportKey('pkcs8', pair.privateKey)),
                type: 'pkcs8',
                format: 'der',
            })
            .export({ type: 'pkcs8', format: 'pem' });
    const pems = await Promise.all(keys.map(privatePem));
    const ca = [
        new BasicConstraintsExtension(true, undefined, true),
        new KeyUsagesExtension(KeyUsageFlags.keyCertSign | KeyUsageFlags.digitalSignature, true),
    ];
    const issue = async (subject, issuer, publicKey, signingKey, extensions, days = 365) => {
        const cert = await X509CertificateGenerator.create(
            {
                subject,
                issuer,
                publicKey,
                signingKey,
                signingAlgorithm: algorithm,
                serialNumber: crypto.randomBytes(16).toString('hex'),
                notBefore: new Date(Date.now() - 60000),
                notAfter: new Date(Date.now() + days * 86400000),
                extensions,
            },
            crypto.webcrypto,
        );
        return cert.toString('pem');
    };
    const root = await issue('CN=Root', 'CN=Root', keys[0].publicKey, keys[0].privateKey, ca);
    const nextRoot = await issue(
        'CN=Next Root',
        'CN=Next Root',
        keys[1].publicKey,
        keys[1].privateKey,
        ca,
    );
    const issuer = await issue('CN=Issuer', 'CN=Root', keys[2].publicKey, keys[0].privateKey, ca);
    const nextIssuer = await issue(
        'CN=Next Issuer',
        'CN=Next Root',
        keys[3].publicKey,
        keys[1].privateKey,
        ca,
    );
    const leafExtensions = [
        new BasicConstraintsExtension(false),
        new KeyUsagesExtension(KeyUsageFlags.digitalSignature),
        new ExtendedKeyUsageExtension(['1.3.6.1.5.5.7.3.3']),
    ];
    const leaf = await issue(
        'CN=owner',
        'CN=Issuer',
        keys[4].publicKey,
        keys[2].privateKey,
        leafExtensions,
        1,
    );
    const transition = {
        payload: {
            format: 'fdo-root-transition-v1',
            from: fingerprint(root),
            to: fingerprint(nextRoot),
            sequence: 2,
            notBefore: new Date().toISOString(),
        },
    };
    transition.signature = crypto
        .sign('sha256', Buffer.from(stableStringify(transition.payload)), pems[0])
        .toString('base64');
    function document(rotated = false, patch = {}) {
        const payload = {
            format: 'fdo-registry-trust-v1',
            sequence: rotated ? 2 : 1,
            issuedAt: new Date().toISOString(),
            expiresAt: new Date(Date.now() + 86400000).toISOString(),
            activeRoot: fingerprint(rotated ? nextRoot : root),
            roots: [
                { pem: root, status: rotated ? 'retired' : 'active' },
                ...(rotated ? [{ pem: nextRoot, status: 'active' }] : []),
            ],
            issuers: [
                { pem: issuer, status: rotated ? 'retired' : 'active' },
                ...(rotated ? [{ pem: nextIssuer, status: 'active' }] : []),
            ],
            transitions: rotated ? [transition] : [],
            ...patch,
        };
        return {
            payload,
            signature: crypto
                .sign('sha256', Buffer.from(stableStringify(payload)), pems[rotated ? 1 : 0])
                .toString('base64'),
        };
    }
    function statusProof(result, nonce, kind, patch = {}) {
        const payload = {
            format: 'fdo-registry-status-v1',
            kind,
            nonce,
            issuedAt: new Date().toISOString(),
            expiresAt: new Date(Date.now() + 120000).toISOString(),
            result,
            ...patch,
        };
        return {
            ...result,
            proof: {
                payload,
                issuerFingerprint: fingerprint(issuer),
                signature: crypto
                    .sign('sha256', Buffer.from(stableStringify(payload)), pems[2])
                    .toString('base64'),
            },
        };
    }
    return {
        root,
        nextRoot,
        issuer,
        nextIssuer,
        leaf,
        key: pems[4],
        chainPem: leaf + '\n' + issuer,
        config: {
            certificateUrl: 'https://registry.example.test/api/v1/registry/certificate',
            trustUrl: 'https://registry.example.test/api/v1/registry/trust',
            rootFingerprint256: fingerprint(root),
        },
        document,
        statusProof,
        async issueDeveloper(publicKeyPem) {
            const publicKey = await crypto.webcrypto.subtle.importKey(
                'spki',
                crypto.createPublicKey(publicKeyPem).export({ format: 'der', type: 'spki' }),
                algorithm,
                true,
                ['verify'],
            );
            const cert = await issue(
                'CN=owner',
                'CN=Issuer',
                publicKey,
                keys[2].privateKey,
                leafExtensions,
            );
            return {
                fingerprint: keyFingerprint(cert),
                status: 'active',
                developerSub: 'owner',
                certificatePem: cert,
                certificateChainPem: cert + '\n' + issuer,
            };
        },
    };
}
