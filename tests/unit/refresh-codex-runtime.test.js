import {refreshCodexRuntime} from "../../src/utils/refreshCodexRuntime";

test("refreshes a saved version using the configured runtime without changing the saved assistant", async () => {
    const assistant = {provider: "codex-cli", executablePath: "/custom/codex", codexRuntime: {version: "0.118.0"}};
    const resolve = jest.fn(async () => ({source: "configured", version: "0.154.0", bundled: false}));
    const refreshed = await refreshCodexRuntime(assistant, resolve);
    expect(resolve).toHaveBeenCalledWith({configuredPath: "/custom/codex", preferBundled: true});
    expect(refreshed.codexRuntime.version).toBe("0.154.0");
    expect(assistant.codexRuntime.version).toBe("0.118.0");
});

test("does not claim a stale runtime is available after resolution fails", async () => {
    const result = await refreshCodexRuntime({provider: "codex-cli", codexRuntime: {version: "0.118.0"}}, async () => {throw new Error("Missing executable");});
    expect(result.codexRuntime).toEqual({source: "unavailable", version: "", bundled: false});
});

test("leaves other providers untouched", async () => {
    const assistant = {provider: "openai"};
    const resolve = jest.fn();
    expect(await refreshCodexRuntime(assistant, resolve)).toBe(assistant);
    expect(resolve).not.toHaveBeenCalled();
});
