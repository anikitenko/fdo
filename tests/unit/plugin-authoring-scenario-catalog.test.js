import {PLUGIN_AUTHORING_SCENARIOS, selectPluginAuthoringScenario, selectPluginAuthoringScenarioById} from "../../src/utils/plugins/authoring/pluginAuthoringScenarioCatalog";

describe("plugin authoring scenario catalogue", () => {
    test('realistic Workbench prompt specifies outcomes without leaking implementation or test hooks', () => {
        for (const seed of ['web-tools-workbench-v1', 'another-human-request']) {
            const scenario = selectPluginAuthoringScenarioById('web-tools-workbench', seed);
            expect(scenario.id).toBe('web-tools-workbench');
            expect(scenario.prompt).toContain('attached screenshot');
            expect(scenario.prompt).toContain('Add tests');
            expect(scenario.prompt.length).toBeLessThan(1300);
            expect(scenario.prompt).not.toMatch(/data-role|data-state|defineRender|createClass|FDO_SDK|node:test|\/index|\.css|\.tsx|Pure CSS|JSON\.parse|WORKSPACE_REPAIR_PATHS/);
        }
    });
    test("selects a reproducible scenario and visual brief from a seed", () => {
        expect(selectPluginAuthoringScenario("repeatable-seed")).toEqual(selectPluginAuthoringScenario("repeatable-seed"));
    });

    test.each(["json-inspector", "rose-calculator"])("%s uses a DevOps request without implementation instructions", (id) => {
        for (const seed of [id, "another-human-request"]) {
            const scenario = selectPluginAuthoringScenarioById(id, seed);
            expect(scenario.prompt).toContain("day-to-day DevOps work");
            expect(scenario.prompt).toContain("work locally without credentials or sending my input anywhere");
            expect(scenario.prompt).toContain("Add tests");
            expect(scenario.prompt).toContain("reduced-motion preferences");
            expect(scenario.prompt.length).toBeLessThan(1400);
            expect(`${scenario.prompt} ${scenario.followUp}`).not.toMatch(/window\.|createBackendReq|PluginRegistry|inspectJson|data-role|data-state|defineRender|createClass|renderHTML|FDO_SDK|fdo-sdk|node:test|node:assert|metadata\.icon|\/index|\.css|\.tsx|Pure CSS|pure-form|pure-button|@media|@keyframes|workspace file sections|line[s]?\b/i);
        }
    });

    test("starts with a local JSON Inspector task", () => {
        const scenario = PLUGIN_AUTHORING_SCENARIOS.find((item) => item.id === "json-inspector");
        expect(scenario).toMatchObject({handler: "inspectJson"});
        expect(scenario.prompt).toContain("Inspect JSON");
        expect(scenario.prompt).toContain("value type, top-level item count, and top-level keys");
        expect(scenario.prompt).toContain("helpful error for malformed input");
    });

    test("defines a rose calculator with calculations, quick actions, history, and a cat backdrop", () => {
        const scenario = selectPluginAuthoringScenarioById("rose-calculator");
        expect(scenario).toMatchObject({id: "rose-calculator", title: "Rose Calculator"});
        expect(scenario.prompt).toContain("decimals, parentheses");
        expect(scenario.prompt).toContain("Clear should empty the input and result");
        expect(scenario.prompt).toContain("double the current number, halve it, or add 10");
        expect(scenario.prompt).toContain("last successful calculation");
        expect(scenario.prompt).toContain("switch between rose themes");
        expect(scenario.prompt).toContain("cat illustration across the background");
        expect(scenario.prompt).toContain("stack them on narrow screens");
    });

    test("defines a credential-free Web Tools Workbench with navigable local utilities", () => {
        const scenario = selectPluginAuthoringScenarioById("web-tools-workbench-contract");
        expect(scenario).toMatchObject({id: "web-tools-workbench-contract", title: "Web Tools Workbench"});
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
