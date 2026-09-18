import {PLUGIN_ASSISTANT_EVALUATIONS, evaluatePluginAssistantResponse} from "../../src/utils/pluginAssistantEvaluation";

test("empty or off-topic responses do not pass knowledge checks", () => {
    const result = evaluatePluginAssistantResponse(PLUGIN_ASSISTANT_EVALUATIONS[0], "");
    expect(result.nonEmpty).toBe(false);
    expect(result.checks.every(check => !check.passed)).toBe(true);
});

test("flags host imports independently of a response mentioning expected SDK terms", () => {
    const result = evaluatePluginAssistantResponse(PLUGIN_ASSISTANT_EVALUATIONS[0], 'PluginRegistry.registerHandler in init; renderOnLoad createBackendReq; import electron from "electron";');
    expect(result.checks.every(check => check.passed)).toBe(true);
    expect(result.scopeViolation).toBe(true);
});
