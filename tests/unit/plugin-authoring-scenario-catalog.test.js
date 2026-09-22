import {PLUGIN_AUTHORING_SCENARIOS, selectPluginAuthoringScenario, selectPluginAuthoringScenarioById} from "../../src/utils/pluginAuthoringScenarioCatalog";

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

    test("defines a stable rose calculator scenario with screenshot-testable actions", () => {
        const scenario = selectPluginAuthoringScenarioById("rose-calculator");
        expect(scenario).toMatchObject({id: "rose-calculator", title: "Rose Calculator"});
        expect(scenario.prompt).toContain('data-role="calculator-display"');
        expect(scenario.prompt).toContain('data-role="calculator-quick-double"');
        expect(scenario.prompt).toContain('data-role="calculator-sidebar"');
        expect(scenario.prompt).toContain("defineRenderOnLoadActions");
        expect(scenario.prompt).toContain("Do not use eval");
        expect(scenario.prompt).toContain("grid");
        expect(scenario.prompt).toContain("prefers-reduced-motion");
    });

    test("defines a credential-free Web Tools Workbench with navigable local utilities", () => {
        const scenario = selectPluginAuthoringScenarioById("web-tools-workbench");
        expect(scenario).toMatchObject({id: "web-tools-workbench", title: "Web Tools Workbench"});
        expect(scenario.prompt).toContain('data-role="tool-library-button"');
        expect(scenario.prompt).toContain('data-role="tool-format-json"');
        expect(scenario.prompt).toContain('type="button" data-role="tool-card-json"');
        expect(scenario.prompt).toContain('Keep it separate from the library control data-role="tool-open-json"');
        expect(scenario.prompt).toContain('data-role="tool-space-dialog"');
        expect(scenario.prompt).toContain("JSON.parse/JSON.stringify");
        expect(scenario.prompt).toContain("defineRenderOnLoadActions");
        expect(scenario.prompt).toContain("pure-form pure-form-stacked");
        expect(scenario.prompt).toContain("prefers-reduced-motion");
        expect(scenario.prompt).toContain('metadata.icon to exactly "applications"');
        expect(scenario.prompt).toMatch(/no network.*shell commands.*cloud credentials/i);
        expect(scenario.prompt).toContain('data-role="tool-card-text"');
        expect(scenario.prompt).toContain('data-role="tool-card-social"');
        expect(scenario.prompt).toContain("Web & SEO analyzes pasted HTML");
        expect(scenario.prompt).toContain("Images & Media inspects pasted data URLs");
        expect(scenario.prompt).toContain("do not reuse or mutate one generic category workspace");
        expect(scenario.prompt).toContain('name="title", name="description", and name="url"');
        expect(scenario.prompt).toContain("renderOnLoad() returns an action object");
        expect(scenario.prompt).toContain("Do not edit the existing /package.json");
        expect(scenario.prompt).toContain("Create additional cohesive plugin-local modules");
        expect(scenario.prompt).not.toContain("Use exactly /index.ts");
        expect(scenario.prompt).not.toContain("or create any other files");
        expect(scenario.prompt).not.toContain("complete files in one response");
        expect(scenario.prompt).toContain("Do not use nested attribute selectors");
        expect(scenario.prompt).toContain(".shell must literally have both a background and min-height");
        expect(scenario.prompt).toContain(".dashboard to grid-template-columns: 1fr");
        expect(scenario.prompt).toContain("extends FDO_SDK and implements FDOInterface");
        expect(scenario.prompt).toContain("Never use BasePlugin or FDOPlugin");
    });
});
