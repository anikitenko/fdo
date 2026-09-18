import {PLUGIN_AUTHORING_SCENARIOS, selectPluginAuthoringScenario} from "../../src/utils/pluginAuthoringScenarioCatalog";

describe("plugin authoring scenario catalogue", () => {
    test("selects a reproducible scenario and visual brief from a seed", () => {
        expect(selectPluginAuthoringScenario("repeatable-seed")).toEqual(selectPluginAuthoringScenario("repeatable-seed"));
    });

    test("starts with a credential-free JSON Inspector task", () => {
        const scenario = PLUGIN_AUTHORING_SCENARIOS.find((item) => item.id === "json-inspector");
        expect(scenario).toMatchObject({handler: "inspectJson"});
        expect(scenario.prompt).toContain("local deterministic data");
        expect(scenario.prompt).toContain("node:test");
        expect(scenario.prompt).toContain("@media (prefers-reduced-motion: reduce)");
        expect(scenario.prompt).toContain("valid: false");
        expect(scenario.prompt).toContain('metadata.icon to exactly "data-search"');
        expect(scenario.prompt).toContain("pure-form pure-form-stacked");
        expect(scenario.prompt).toContain("pure-button pure-button-primary");
        expect(scenario.prompt).toContain("never return {ok: false}");
        expect(scenario.prompt).toContain('never css[".panel"]');
        expect(scenario.prompt).toContain("polished compact tool");
        expect(scenario.prompt).toContain("animation: none");
        expect(scenario.prompt).toContain('data-state to "success"');
        expect(scenario.prompt).toContain('Set it to "error"');
        expect(scenario.prompt).toContain("handler receives the content object directly");
        expect(scenario.prompt).toContain("Do not read data.content.json");
        expect(scenario.prompt).not.toMatch(/azure|aws|gcp/i);
    });
});
