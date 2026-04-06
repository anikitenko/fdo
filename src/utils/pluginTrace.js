export function pluginTrace(event, details = {}) {
    // Temporary plugin trace instrumentation was intentionally removed after
    // stability was validated in E2E. Keep call sites as no-op hooks.
    void event;
    void details;
}
