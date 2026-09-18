export async function refreshCodexRuntime(assistant, resolveInvocation) {
    if (assistant.provider !== "codex-cli") return assistant;
    try {
        const invocation = await resolveInvocation({
            configuredPath: assistant.executablePath,
            preferBundled: true,
        });
        return {...assistant, codexRuntime: {
            source: invocation.source,
            version: invocation.version || "",
            bundled: !!invocation.bundled,
        }};
    } catch (_) {
        // Do not present a cached version as a successfully detected runtime.
        return {...assistant, codexRuntime: {source: "unavailable", version: "", bundled: false}};
    }
}
