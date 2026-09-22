import {detectAiPluginRuntimeIntent} from "../../src/components/editor/utils/aiCodingAgentPluginRuntimeIntent.js";

describe("detectAiPluginRuntimeIntent", () => {
    test.each([
        "Please rename this plugin to Quasar Quill. Update the plugin metadata name in /index.ts and make /render.tsx show the same visible heading. Apply the changes in the current plugin workspace only. If you change multiple files, return executable workspace file sections.",
        "Read the plugin source and explain its metadata.",
        "Update the plugin view to show a subscription selector.",
    ])("does not run runtime actions for source/UI requests: %s", (prompt) => {
        const result = detectAiPluginRuntimeIntent(prompt);
        expect(result.shouldProbe).toBe(false);
        expect(result.wantsLogs).toBe(false);
    });

    test.each(["show plugin logs", "read plugin stdout", "view plugin stderr"])("still recognizes log requests: %s", (prompt) => {
        expect(detectAiPluginRuntimeIntent(prompt).shouldProbe).toBe(true);
    });

    test("returns probe=false for generic coding prompts", () => {
        const result = detectAiPluginRuntimeIntent("please refactor index.ts");
        expect(result.shouldProbe).toBe(false);
    });

    test("does not mistake scaffold design language for a runtime action request", () => {
        const result = detectAiPluginRuntimeIntent([
            "Create a functional Rose Calculator plugin.",
            "Use a verified BlueprintJS icon, render an iframe UI, and open its sidebar when a user clicks History.",
            "Add node:test coverage and apply complete workspace files.",
        ].join(" "));
        expect(result).toEqual({
            shouldProbe: false,
            wantsLogs: false,
            wantsActivate: false,
            wantsDeactivate: false,
            wantsInit: false,
            wantsRender: false,
            wantsRestart: false,
        });
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

    test("detects quoted plugin log inspection intent", () => {
        const result = detectAiPluginRuntimeIntent('please checkout logs of "Fixture: Terraform Operator" plugin');
        expect(result.shouldProbe).toBe(true);
        expect(result.wantsLogs).toBe(true);
        expect(result.wantsActivate).toBe(false);
    });
});
