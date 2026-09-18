import fs from "node:fs";
import path from "node:path";
import {
    PLUGIN_AUTHORING_GUIDE_VERSION,
    PLUGIN_RUNTIME_CATALOG,
    PLUGIN_STYLESHEET_CONTRACT,
    PLUGIN_UI_HELPERS,
    buildPluginAuthoringGuide,
    buildPluginCodingPrompt,
} from "../../src/utils/pluginAuthoringGuide";

describe("shared plugin authoring guide", () => {
    test("lists only runtime assets actually loaded by the plugin iframe", () => {
        const hostHtml = fs.readFileSync(path.resolve("src/plugin_host.html"), "utf8");
        const requiredAssets = ["pure-min.css", "fontawesome.min.js", "split-grid.js", "highlight.min.js", "notyf.min.js", "goober.umd.js", "ace.js"];
        for (const asset of requiredAssets) {
            expect(hostHtml).toContain(asset);
        }
        expect(PLUGIN_RUNTIME_CATALOG.map((item) => item.name)).toEqual([
            "Pure CSS", "Font Awesome", "Split Grid", "highlight.js", "Notyf", "Goober", "Ace",
        ]);
    });

    test("keeps public helpers aligned with the plugin host contract", () => {
        const source = fs.readFileSync(path.resolve("src/components/plugin/PluginPage.jsx"), "utf8");
        for (const helper of PLUGIN_UI_HELPERS) {
            const name = helper.match(/window\.([A-Za-z]+)/)?.[1];
            expect(name).toBeTruthy();
            expect(source).toContain(`window.${name}`);
        }
    });

    test("documents the actual virtual stylesheet loader rather than inventing Sass support", () => {
        const source = fs.readFileSync(path.resolve("src/utils/esbuild/plugins/virtual-fs.js"), "utf8");
        expect(source).toContain("build.onLoad({filter: /\\.css$/}");
        expect(source).toContain("extractCssStyles(latestContent[args.path])");
        expect(source).not.toContain("sass.compile");
        expect(PLUGIN_STYLESHEET_CONTRACT.join("\n")).toContain("not a Sass compiler");
        expect(PLUGIN_STYLESHEET_CONTRACT.join("\n")).toContain("extensionless imports are unsupported");
        expect(PLUGIN_STYLESHEET_CONTRACT.join("\n")).toContain("SCSS-like nested rule blocks");
        expect(PLUGIN_STYLESHEET_CONTRACT.join("\n")).toContain("never call DOM.createClassFromStyle");
        expect(PLUGIN_STYLESHEET_CONTRACT.join("\n")).toContain('css.panel');
        expect(PLUGIN_STYLESHEET_CONTRACT.join("\n")).toContain('css[".panel"]');
        expect(PLUGIN_STYLESHEET_CONTRACT.join("\n")).toContain("prefers-reduced-motion");
    });

    test("contains provider-neutral safety, UI, and test guidance", () => {
        const guide = buildPluginAuthoringGuide();
        expect(guide).toContain(`v${PLUGIN_AUTHORING_GUIDE_VERSION}`);
        expect(guide).toContain("Do not claim all models produce identical results");
        expect(guide).toContain("node:test and node:assert/strict");
        expect(guide).toContain("Do not require cloud credentials");
        expect(guide).toContain("distinctive visual identity");
        expect(guide).toContain("pure-form pure-form-stacked");
        expect(guide).toContain("pure-button pure-button-primary");
        expect(guide).toContain("Do not use React, JSX, className, htmlFor, or react/jsx-runtime");
        expect(guide).toContain("DOM.createElement(...) is not a static SDK method");
        expect(guide).toContain("Do not pass new DOMNested([...]) or new DOMText(\"text\") as children");
        expect(guide).toContain("data-bound");
        expect(guide).toContain("jsonInspectorBound");
        expect(guide).toContain("defineRenderOnLoadActions(...)");
        expect(guide).toContain('type="button"');
        expect(guide).toContain("read data.json");
        expect(guide).toContain("never read data.content.json");
        expect(guide).toContain("PLUGIN STYLESHEET CONTRACT");
        expect(guide).not.toMatch(/src\/ipc|PluginPage\.jsx|settings\.json/);
    });

    test("wraps every CLI coding request with the same public guide", () => {
        const prompt = buildPluginCodingPrompt("Build a JSON Inspector.");
        expect(prompt).toContain("SHARED FDO PLUGIN AUTHORING GUIDE");
        expect(prompt).toContain("Build a JSON Inspector.");
    });

    test("supplies the guide to API system prompts and CLI prompts", () => {
        const source = fs.readFileSync(path.resolve("src/ipc/ai_coding_agent.js"), "utf8");
        expect(source).toContain("${buildPluginAuthoringGuide()}");
        expect(source).toContain("const providerPrompt = isCliProvider ? buildPluginCodingPrompt(prompt) : prompt;");
    });
});
