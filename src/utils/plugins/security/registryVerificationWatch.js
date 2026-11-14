// Activation verifies immediately; this watchdog bounds trust/revocation propagation while running.
export function watchRegistryPlugin({ verify, isCurrent, blocked, interval = 5 * 60 * 1000 }) {
    let active = true,
        checking = false;
    const check = async () => {
        if (!active || checking || !isCurrent()) return;
        checking = true;
        let result;
        try {
            result = await verify();
        } catch (error) {
            result = { success: false, error: error.message };
        } finally {
            checking = false;
        }
        if (active && isCurrent() && !result?.success) {
            try {
                blocked(result || { success: false, error: 'Registry verification failed.' });
            } catch {
                /* The host's stop action runs before optional reporting. */
            }
        }
    };
    const timer = setInterval(() => {
        void check();
    }, interval);
    timer.unref?.();
    return () => {
        active = false;
        clearInterval(timer);
    };
}
