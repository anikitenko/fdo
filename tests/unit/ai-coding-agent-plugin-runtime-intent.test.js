import {detectAiPluginRuntimeIntent} from "../../src/components/editor/utils/aiCodingAgentPluginRuntimeIntent.js";

describe("detectAiPluginRuntimeIntent", () => {
    test("returns probe=false for generic coding prompts", () => {
        const result = detectAiPluginRuntimeIntent("please refactor index.ts");
        expect(result.shouldProbe).toBe(false);
    });

    test("detects verification + log intent for plugin prompts", () => {
        const result = detectAiPluginRuntimeIntent("can you run plugin and verify logs?");
        expect(result.shouldProbe).toBe(true);
        expect(result.wantsActivate).toBe(true);
        expect(result.wantsInit).toBe(true);
        expect(result.wantsRender).toBe(true);
        expect(result.wantsLogs).toBe(true);
    });

    test("detects deactivate-only plugin intent", () => {
        const result = detectAiPluginRuntimeIntent("disable plugin and check logs");
        expect(result.shouldProbe).toBe(true);
        expect(result.wantsDeactivate).toBe(true);
        expect(result.wantsLogs).toBe(true);
    });

    test("detects restart intent", () => {
        const result = detectAiPluginRuntimeIntent("restart plugin and verify trace");
        expect(result.shouldProbe).toBe(true);
        expect(result.wantsRestart).toBe(true);
        expect(result.wantsActivate).toBe(true);
    });
});
