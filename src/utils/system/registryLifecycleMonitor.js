import { officialRegistry } from './officialRegistry';
import { registryIdentityLifecycle } from './registryIdentity';
import { certificateStorage } from '../persistence/certificateStorage';
import {organizationRegistries} from './organizationRegistries';
// Refreshes on startup and while FDO stays open. Signing still performs its own fresh check.
export function startRegistryLifecycleMonitor({
    registry = officialRegistry,
    lifecycle = registryIdentityLifecycle,
    storage = certificateStorage,
    onError = () => {},
    organizations = registry === officialRegistry ? organizationRegistries : undefined,
} = {}) {
    let active = true,
        running = false;
    const check = async () => {
        if (!active || running) return;
        running = true;
        try {
            const connections = [{registry, lifecycle, scope: 'registry'}, ...(organizations?.list() || []).map(item => organizations.get(item.id))];
            for (const current of connections) {
                if (!active || !current.registry.configured()) continue;
                try {
                    await current.registry.ensureAnchor();
                    for (const entry of storage.list(current.scope).filter(item => item.kind === 'developer' && (!current.connection || item.registryId === current.connection.id))) {
                        if (!active) break;
                        try {await current.lifecycle.ensureIdentity(entry);} catch (error) {onError(error, entry);}
                    }
                } catch (error) {onError(error, current.connection);}
            }
        } catch (error) {
            onError(error);
        } finally {
            running = false;
        }
    };
    const timer = setInterval(() => {
        void check();
    }, 6 * 3600000);
    timer.unref?.();
    void check();
    return () => {
        active = false;
        clearInterval(timer);
    };
}
