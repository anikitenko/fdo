import crypto from 'node:crypto';
import configuration from '../../config/officialRegistry.json';
import {settings} from '../persistence/store';
import {certificateStorage} from '../persistence/certificateStorage';
import {createOfficialRegistry, officialRegistry} from './officialRegistry';
import {createRegistryIdentityLifecycle, registryIdentityLifecycle} from './registryIdentity';

const officialOrigin = () => configuration.certificateUrl ? new URL(configuration.certificateUrl).origin : undefined;

export function normalizeOrganizationRegistry(input) {
    if (!input || typeof input.name !== 'string' || !input.name.trim() || input.name.trim().length > 80 || /[\x00-\x1f\x7f]/.test(input.name))
        throw new Error('Enter an organization name between 1 and 80 characters.');
    let url;
    try {url = new URL(input.url);} catch {throw new Error('Enter the private registry HTTPS address, for example https://plugins.example.com.');}
    if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash || input.url.length > 2048)
        throw new Error('Use an HTTPS origin without a path, credentials, query or fragment.');
    if (url.origin === officialOrigin())
        throw new Error('The official registry is already managed by FDO. Add your organization’s private registry instead.');
    const rootFingerprint256 = String(input.rootFingerprint256 || '').replace(/:/g, '').trim().toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(rootFingerprint256))
        throw new Error('Enter the root certificate’s SHA-256 fingerprint (64 hexadecimal characters). Obtain it independently from your administrator.');
    return {
        id: `org-${crypto.createHash('sha256').update(url.origin).digest('hex').slice(0, 24)}`,
        name: input.name.trim(), url: url.origin, rootFingerprint256,
    };
}

// Connection metadata contains only public trust configuration. All private keys
// stay in the existing OS-protected certificate database, in the org scope.
export function createOrganizationRegistries({store = settings, storage = certificateStorage,
    createClient = createOfficialRegistry, createLifecycle = createRegistryIdentityLifecycle} = {}) {
    const clients = new Map();
    const list = () => store.get('organizationRegistries') || [];
    const official = () => ({registry: officialRegistry, lifecycle: registryIdentityLifecycle, scope: 'registry'});
    function build(connection, assertActive = () => {}) {
        const config = {
            certificateUrl: new URL('/api/v1/registry/certificate', connection.url).href,
            trustUrl: new URL('/api/v1/registry/trust', connection.url).href,
            rootFingerprint256: connection.rootFingerprint256,
        };
        const registry = createClient({config, storage, scope: 'org', registryId: connection.id, label: connection.name, assertActive});
        return {registry, lifecycle: createLifecycle({registry, storage, scope: 'org', registryId: connection.id, registryName: connection.name}), scope: 'org', connection};
    }
    function get(id) {
        if (id === undefined || id === 'official') return official();
        const connection = list().find(item => item.id === id);
        if (!connection) throw new Error('This private registry is not connected. Add it in Settings → Certificates.');
        const cached = clients.get(id)?.connection;
        if (cached && (cached.rootFingerprint256 !== connection.rootFingerprint256 || cached.url !== connection.url || cached.name !== connection.name)) clients.delete(id);
        if (!clients.has(id)) {
            const assertActive = () => {
                if (clients.get(id)?.connection !== connection || !list().some(item => item.id === id && item.rootFingerprint256 === connection.rootFingerprint256))
                    throw new Error('This private registry connection was removed or changed.');
            };
            clients.set(id, build(connection, assertActive));
        }
        return clients.get(id);
    }
    return {
        list,
        get,
        forOrigin(origin) {
            if (origin === undefined || origin === officialOrigin()) return official();
            const connection = list().find(item => item.url === origin);
            if (!connection) throw new Error('The plugin’s private registry is no longer trusted. Reconnect it in Settings → Certificates.');
            return get(connection.id);
        },
        forCertificate(entry) {
            if (entry.scope !== 'org') return official();
            if (!entry.registryId) throw new Error('This organization certificate is not associated with a private registry. Import it from a connected registry.');
            return get(entry.registryId);
        },
        async add(input) {
            const connection = normalizeOrganizationRegistry(input);
            if (list().some(item => item.id === connection.id)) throw new Error('This private registry is already connected. Remove it before changing its trust pin.');
            if (list().length >= 20) throw new Error('You can connect up to 20 private registries.');
            // Verify the independently supplied pin and signed lifecycle document
            // before committing a connection. Never trust a root downloaded on faith.
            await build(connection).registry.trust();
            // Another window/CLI operation may have connected it while checking.
            if (list().some(item => item.id === connection.id)) throw new Error('This private registry is already connected.');
            store.set('organizationRegistries', [...list(), connection]);
            return connection;
        },
        remove(id) {
            if (!list().some(item => item.id === id)) throw new Error('Private registry connection not found.');
            store.set('organizationRegistries', list().filter(item => item.id !== id));
            clients.delete(id);
            for (const entry of storage.list('org').filter(item => item.registryId === id)) storage.remove(entry.id, 'org');
        },
    };
}

export const organizationRegistries = createOrganizationRegistries();
