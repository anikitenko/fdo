import { officialRegistry } from './officialRegistry';
import { registryIdentityLifecycle } from './registryIdentity';
import { certificateStorage } from '../persistence/certificateStorage';
// Refreshes on startup and while FDO stays open. Signing still performs its own fresh check.
export function startRegistryLifecycleMonitor({
    registry = officialRegistry,
    lifecycle = registryIdentityLifecycle,
    storage = certificateStorage,
    onError = () => {},
} = {}) {
    let active = true,
        running = false;
    const check = async () => {
        if (!active || running || !registry.configured()) return;
        running = true;
        try {
            await registry.ensureAnchor();
            for (const entry of storage
                .list('registry')
                .filter((item) => item.kind === 'developer')) {
                if (!active) break;
                try {
                    await lifecycle.ensureIdentity(entry);
                } catch (error) {
                    onError(error, entry);
                }
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
