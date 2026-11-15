import {registryNetworkError} from './registryNetworkError';
import configuration from '../../config/officialRegistry.json';
import { certificateStorage } from '../persistence/certificateStorage';
import { certificatePems, validateRegistryAnchor } from './registrySigning';
import {
    validateTrustDocument,
    validateStatusProof,
    validateAuthorityChain,
    fingerprint,
    keyFingerprint,
} from './registryTrust';
import crypto from 'node:crypto';

export function createOfficialRegistry({
    config = configuration,
    storage = certificateStorage,
    fetchCertificate = (...args) => fetch(...args),
    now = () => Date.now(),
    scope = 'registry',
    registryId,
    label = 'FDO Plugin Registry',
    assertActive = () => {},
} = {}) {
    const entryId = cert => registryId ? `${registryId}/${cert.fingerprint256}` : cert.fingerprint256;
    let pending,
        trust,
        checkedAt = 0;
    const configured = () =>
        !!config.certificateUrl && !!(config.rootFingerprint256 || config.rootPublicKeySha256);
    const base = () => {
        const url = new URL(config.certificateUrl);
        if (url.protocol !== 'https:' || url.username || url.password)
            throw new Error('The registry certificate URL must use HTTPS.');
        return url;
    };
    async function download(url, options = {}, maxBytes = 128 * 1024) {
        assertActive();
        let response;
        try {response = await fetchCertificate(url, {
            redirect: 'error',
            cache: 'no-store',
            signal: AbortSignal.timeout(10000),
            ...options,
        });} catch (error) {throw registryNetworkError(error, url);}
        if (!response.ok) {
            const error = new Error(
                `Registry request failed (${response.status}). Signing and verification require a current registry status.`,
            );
            error.status = response.status;
            throw error;
        }
        let size = 0;
        const chunks = [];
        if (Number(response.headers.get('content-length')) > maxBytes)
            throw new Error('Registry certificate response is too large.');
        for await (const chunk of response.body) {
            size += chunk.length;
            if (size > maxBytes) throw new Error('Registry certificate response is too large.');
            chunks.push(Buffer.from(chunk));
        }
        assertActive();
        return Buffer.concat(chunks).toString('utf8');
    }
    async function load() {
        if (!configured()) throw new Error('The official registry is not available yet.');
        const url = base(),
            entries = storage.list(scope);
        assertActive();
        const existing = entries
            .filter(
                (entry) =>
                    entry.kind === 'anchor' &&
                    entry.official === !registryId &&
                    entry.registryId === registryId &&
                    entry.registryCertificateUrl === url.href,
            )
            .sort((a, b) => (b.trustSequence || 0) - (a.trustSequence || 0))[0];
        if (config.trustUrl) {
            const trustUrl = new URL(config.trustUrl);
            if (trustUrl.origin !== url.origin)
                throw new Error('Registry trust must use the configured origin.');
            if (trustUrl.protocol !== 'https:' || trustUrl.username || trustUrl.password || trustUrl.hash)
                throw new Error('Registry trust must use HTTPS without credentials or a fragment.');
            if (trust && now() - checkedAt < 300000 && Date.parse(trust.payload.expiresAt) > now())
                return existing;
            const document = JSON.parse(await download(trustUrl.href, {}, 512 * 1024));
            const current = validateTrustDocument(
                document,
                config,
                existing?.trustDocument?.payload,
                now(),
            );
            const cert = new crypto.X509Certificate(current.root);
            const entry = {
                id: entryId(cert),
                label,
                cert: current.root,
                kind: 'anchor',
                official: !registryId,
                ...(registryId ? {registryId, registryName: label, fingerprint256: cert.fingerprint256} : {}),
                registryCertificateUrl: url.href,
                createdAt: existing?.id === entryId(cert) ? existing.createdAt : new Date(now()).toISOString(),
                expiresAt: new Date(cert.validTo).toISOString(),
                trustSequence: current.payload.sequence,
                trustDocument: document,
            };
            assertActive();
            storage.put(entry, scope);
            trust = current;
            checkedAt = now();
            return entry;
        }
        // Compatibility with older registry deployments pinned by the FDO release.
        if (existing) {
            try {
                validateRegistryAnchor(existing.cert, config.rootFingerprint256);
                return existing;
            } catch {}
        }
        const pem = await download(url.href);
        if (certificatePems(pem).length !== 1)
            throw new Error('The official registry must return one root certificate.');
        const cert = validateRegistryAnchor(pem, config.rootFingerprint256);
        const entry = {
            id: entryId(cert),
            label,
            cert: cert.toString(),
            kind: 'anchor',
            official: !registryId,
            registryCertificateUrl: url.href,
            createdAt: new Date(now()).toISOString(),
            expiresAt: new Date(cert.validTo).toISOString(),
        };
        assertActive();
        storage.put(entry, scope);
        return entry;
    }
    async function ensureAnchor() {
        assertActive();
        if (!pending)
            pending = load().finally(() => {
                pending = undefined;
            });
        return pending;
    }
    async function certificateStatus(publicKeyId) {
        await ensureAnchor();
        if (!/^[a-f0-9]{64}$/.test(publicKeyId))
            throw new Error('Invalid signing identity fingerprint.');
        const nonce = crypto.randomBytes(32).toString('hex');
        const url = new URL(`/api/v1/certificates/${publicKeyId}`, base());
        url.searchParams.set('nonce', nonce);
        const status = JSON.parse(await download(url.href));
        if (
            status.fingerprint !== publicKeyId ||
            status.status !== 'active' ||
            !status.certificatePem ||
            keyFingerprint(status.certificatePem) !== publicKeyId
        )
            throw Object.assign(new Error(
                'Developer certificate was revoked, expired or is unavailable. Recover it in your registry account.',
            ), {code: 'REGISTRY_CERTIFICATE_INACTIVE', lifecycleStatus: status.status === 'revoked' ? 'revoked' : status.status === 'expired' ? 'expired' : 'unavailable'});
        if (
            trust &&
            fingerprint(validateAuthorityChain(status.certificateChainPem, trust).toString()) !==
                fingerprint(status.certificatePem)
        )
            throw new Error('Registry certificate does not match its validated chain.');
        if (trust) validateStatusProof(status, nonce, 'certificate', trust, now());
        return status;
    }
    return {
        assertActive,
        configured,
        ensureAnchor,
        certificateStatus,
        async trust() {
            await ensureAnchor();
            if (!trust) throw new Error('Registry lifecycle metadata is unavailable.');
            return trust;
        },
        // Catalog names are presentation only; releaseStatus and source verification
        // independently establish identity and trust before installation approval.
        async releaseDisplayName(pluginId, version) {
            if (!/^[a-z0-9][a-z0-9._-]{0,127}$/.test(pluginId) || typeof version !== 'string' || version.length > 80)
                throw new Error('Invalid registry release.');
            const url = new URL(`/api/v1/plugins/${encodeURIComponent(pluginId)}`, base());
            url.searchParams.set('version', version);
            url.searchParams.set('limit', '1');
            const detail = JSON.parse(await download(url.href));
            if (detail.plugin?.id !== pluginId) throw new Error('Registry catalog identity does not match.');
            const release = detail.releases?.find(item => item.version === version);
            const name = release?.manifest?.name || detail.plugin.name;
            return typeof name === 'string' && name.trim() && name.length <= 240 ? name.trim() : null;
        },
        async releaseStatus(pluginId, version) {
            await ensureAnchor();
            if (
                !/^[a-z0-9][a-z0-9._-]{0,127}$/.test(pluginId) ||
                typeof version !== 'string' ||
                version.length > 80
            )
                throw new Error('Invalid registry release.');
            const nonce = crypto.randomBytes(32).toString('hex');
            const url = new URL(
                `/api/v1/releases/${encodeURIComponent(pluginId)}/${encodeURIComponent(version)}/status`,
                base(),
            );
            url.searchParams.set('nonce', nonce);
            const status = JSON.parse(await download(url.href));
            if (status.pluginId !== pluginId || status.version !== version)
                throw new Error('Registry status does not match the requested release.');
            if (status.status !== 'active')
                throw Object.assign(new Error(
                    'This release is unavailable because the plugin, release, or publisher’s signing certificate was revoked or expired. Choose an active release from the registry.',
                ), {code: 'REGISTRY_RELEASE_INACTIVE'});
            if (!trust) throw new Error('Registry lifecycle metadata is unavailable.');
            if (
                fingerprint(
                    validateAuthorityChain(status.certificateChainPem, trust).toString(),
                ) !== fingerprint(status.certificatePem)
            )
                throw new Error('Release signer does not match its validated chain.');
            validateStatusProof(status, nonce, 'release', trust, now());
            return status;
        },
        async renewIdentity(payload) {
            const body = JSON.stringify(payload);
            return JSON.parse(
                await download(
                    new URL(`/api/v1/certificates/${payload.previousFingerprint}/renew`, base())
                        .href,
                    {
                        method: 'POST',
                        headers: {
                            'content-type': 'application/json',
                            'x-amz-content-sha256': crypto
                                .createHash('sha256')
                                .update(body)
                                .digest('hex'),
                        },
                        body,
                    },
                ),
            );
        },
    };
}
export const officialRegistry = createOfficialRegistry();
