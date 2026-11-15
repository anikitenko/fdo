import crypto from 'node:crypto';
import { stableStringify, validateRegistryCertificate } from './registrySigning';
import { verifyCertificateChain } from './certificateChain';
export const fingerprint = (pem) =>
    new crypto.X509Certificate(pem).fingerprint256.replace(/:/g, '').toLowerCase();
export const keyFingerprint = (pem) =>
    crypto
        .createHash('sha256')
        .update(new crypto.X509Certificate(pem).publicKey.export({ type: 'spki', format: 'der' }))
        .digest('hex');
const normalize = (value) =>
    String(value || '')
        .replace(/:/g, '')
        .toLowerCase();
const verify = (payload, signature, pem) =>
    typeof signature === 'string' &&
    crypto.verify(
        'sha256',
        Buffer.from(stableStringify(payload)),
        new crypto.X509Certificate(pem).publicKey,
        Buffer.from(signature, 'base64'),
    );
export function validateTrustDocument(document, config, previous, now = Date.now()) {
    const p = document?.payload;
    if (
        !p ||
        p.format !== 'fdo-registry-trust-v1' ||
        !Number.isSafeInteger(p.sequence) ||
        p.sequence < 1 ||
        !Array.isArray(p.roots) ||
        p.roots.length > 64 ||
        !Array.isArray(p.issuers) ||
        p.issuers.length > 128 ||
        !Array.isArray(p.transitions) ||
        p.transitions.length > 64 ||
        !Number.isFinite(Date.parse(p.issuedAt)) ||
        !Number.isFinite(Date.parse(p.expiresAt)) ||
        Date.parse(p.issuedAt) > now + 60000 ||
        Date.parse(p.expiresAt) <= now ||
        Date.parse(p.expiresAt) - Date.parse(p.issuedAt) > 49 * 3600000 ||
        (previous &&
            (p.sequence < previous.sequence ||
                Date.parse(p.issuedAt) < Date.parse(previous.issuedAt)))
    )
        throw new Error('Registry trust is stale, rolled back or invalid.');
    const roots = new Map(p.roots.map((item) => [fingerprint(item.pem), item]));
    if (
        roots.size !== p.roots.length ||
        p.roots.some((item) => !['active', 'retired', 'revoked'].includes(item.status))
    )
        throw new Error('Invalid registry roots.');
    const revokedRootKeys = new Set(
        p.roots.filter((item) => item.status === 'revoked').map((item) => keyFingerprint(item.pem)),
    );
    if (p.issuers.some((item) => !['active', 'retired', 'revoked'].includes(item.status)))
        throw new Error('Invalid registry issuers.');
    const trusted = new Set(
        [...roots]
            .filter(
                ([id, item]) =>
                    id === normalize(config.rootFingerprint256) ||
                    keyFingerprint(item.pem) === normalize(config.rootPublicKeySha256),
            )
            .map(([id]) => id),
    );
    let lastSequence = 0;
    for (const { payload, signature } of p.transitions) {
        if (
            payload?.format !== 'fdo-root-transition-v1' ||
            !Number.isSafeInteger(payload.sequence) ||
            payload.sequence <= lastSequence ||
            payload.sequence > p.sequence ||
            !roots.has(payload.from) ||
            !roots.has(payload.to) ||
            !Number.isFinite(Date.parse(payload.notBefore)) ||
            Date.parse(payload.notBefore) > now + 60000
        )
            throw new Error('Invalid registry root transition.');
        lastSequence = payload.sequence;
        const old = roots.get(payload.from),
            next = roots.get(payload.to);
        if (
            trusted.has(payload.from) &&
            old.status !== 'revoked' &&
            !revokedRootKeys.has(keyFingerprint(old.pem))
        ) {
            const at = new Date(payload.notBefore);
            verifyCertificateChain([new crypto.X509Certificate(old.pem)], [old.pem], at);
            verifyCertificateChain([new crypto.X509Certificate(next.pem)], [next.pem], at);
            if (!verify(payload, signature, old.pem))
                throw new Error('Invalid registry root transition signature.');
            trusted.add(payload.to);
        }
    }
    const active = roots.get(p.activeRoot);
    if (
        !active ||
        active.status !== 'active' ||
        !trusted.has(p.activeRoot) ||
        revokedRootKeys.has(keyFingerprint(active.pem))
    )
        throw new Error('Registry root replacement is not authorized by the trusted pin or a valid root transition.');
    const root = new crypto.X509Certificate(active.pem);
    if (!root.ca || !root.checkIssued(root) || !root.verify(root.publicKey))
        throw new Error('Registry root is not a self-signed CA.');
    verifyCertificateChain([root], [active.pem], new Date(now));
    if (!verify(p, document.signature, active.pem))
        throw new Error('Invalid registry trust signature.');
    const anchors = [...roots]
        .filter(
            ([id, item]) =>
                trusted.has(id) &&
                item.status !== 'revoked' &&
                !revokedRootKeys.has(keyFingerprint(item.pem)),
        )
        .map(([, item]) => item.pem);
    return { payload: p, anchors, root: active.pem };
}
export function validateAuthorityChain(chainPem, trust) {
    const chain = (
        String(chainPem).match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g) ||
        []
    ).map((pem) => new crypto.X509Certificate(pem));
    if (chain.length < 2) throw new Error('A registry developer issuer chain is required.');
    const issuer = trust.payload.issuers.find(
        (item) => fingerprint(item.pem) === fingerprint(chain[1].toString()),
    );
    if (
        !issuer ||
        issuer.status === 'revoked' ||
        trust.payload.issuers.some(
            (item) =>
                item.status === 'revoked' &&
                keyFingerprint(item.pem) === keyFingerprint(issuer.pem),
        )
    )
        throw new Error('Developer issuer was revoked or is unknown.');
    return validateRegistryCertificate(chainPem, trust.anchors);
}

export function validateStatusProof(status, nonce, kind, trust, now = Date.now()) {
    const { proof, ...result } = status;
    const payload = proof?.payload;
    if (
        !payload ||
        payload.format !== 'fdo-registry-status-v1' ||
        payload.kind !== kind ||
        payload.nonce !== nonce ||
        !Number.isFinite(Date.parse(payload.issuedAt)) ||
        !Number.isFinite(Date.parse(payload.expiresAt)) ||
        Date.parse(payload.issuedAt) > now + 60000 ||
        Date.parse(payload.expiresAt) <= now ||
        Date.parse(payload.expiresAt) - Date.parse(payload.issuedAt) > 180000 ||
        stableStringify(payload.result) !== stableStringify(result)
    )
        throw new Error('Registry status proof is missing, stale or does not match this request.');
    const issuer = trust.payload.issuers.find(
        (item) => fingerprint(item.pem) === proof.issuerFingerprint && item.status === 'active',
    );
    if (
        !issuer ||
        trust.payload.issuers.some(
            (item) =>
                item.status === 'revoked' &&
                keyFingerprint(item.pem) === keyFingerprint(issuer.pem),
        )
    )
        throw new Error('Registry status signer is revoked or unknown.');
    const certificate = new crypto.X509Certificate(issuer.pem);
    if (!certificate.ca) throw new Error('Registry status signer is not an issuer.');
    verifyCertificateChain([certificate], trust.anchors, new Date(now));
    if (!verify(payload, proof.signature, issuer.pem))
        throw new Error('Invalid registry status signature.');
}
