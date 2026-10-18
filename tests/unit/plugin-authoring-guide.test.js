import fs from "node:fs";
import path from "node:path";
import {execFileSync} from 'node:child_process';
import * as Babel from '@babel/standalone';
import {installPluginGlobalEvents} from '../../src/components/plugin/utils/pluginGlobalEvents';
import {
    PLUGIN_AUTHORING_GUIDE_VERSION,
    PLUGIN_RUNTIME_CATALOG,
    PLUGIN_STYLESHEET_CONTRACT,
    PLUGIN_STYLE_RENDERING_EXAMPLE,
    PLUGIN_UI_HELPERS,
    buildPluginAuthoringGuide,
    buildPluginCodingPrompt,
} from "../../src/utils/plugins/authoring/pluginAuthoringGuide";

describe("shared plugin authoring guide", () => {
    test('canonical composition emits palette and child CSS using the installed SDK', () => {
        const js = Babel.transform(PLUGIN_STYLE_RENDERING_EXAMPLE, {
            filename: 'render.ts', presets: ['typescript'], plugins: ['transform-modules-commonjs'],
        }).code;
        const script = `const sdk = require('@anikitenko/fdo-sdk');
const styles = {palette: {'--ink': '#e7f0ea'}, panel: {display: 'grid', color: 'var(--ink)'}};
const result = {};
new Function('require', 'exports', ${JSON.stringify(js)})(name => name === './styles.css' ? styles : sdk, result);
process.stdout.write(result.renderView());`;
        const html = execFileSync(process.execPath, ['-e', script], {encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']});
        expect(html).toContain('<style>');
        expect(html).toContain('--ink:#e7f0ea');
        expect(html).toContain('display:grid');
        expect(html).toContain('color:var(--ink)');
        expect(html).toMatch(/<main class="[^"]+"><section class="[^"]+">Content<\/section><\/main>/);
    });
    test("lists only runtime assets actually loaded by the plugin iframe", () => {
        const hostHtml = fs.readFileSync(path.resolve("src/plugin_host.html"), "utf8");
        const requiredAssets = ["pure-min.css", "fontawesome.min.js", "split-grid.js", "highlight.min.js", "notyf.min.js", "goober.umd.js", "ace.js"];
        for (const asset of requiredAssets) {
            expect(hostHtml).toContain(asset);
        }
        expect(PLUGIN_RUNTIME_CATALOG.map((item) => item.name)).toEqual([
            "Pure CSS", "Font Awesome", "Split Grid", "highlight.js", "Notyf", "Goober", "FDOTerminal", "Ace",
        ]);
    });

    test("keeps public helpers aligned with the plugin host contract", () => {
        const source = fs.readFileSync(path.resolve("src/components/plugin/PluginPage.jsx"), "utf8");
        const target = new EventTarget();
        const events = installPluginGlobalEvents(target);
        try {
            for (const helper of PLUGIN_UI_HELPERS) {
                const names = [...helper.matchAll(/window\.([A-Za-z]+)/g)].map(match => match[1]);
                expect(names.length).toBeGreaterThan(0);
                for (const name of names) {
                    if (name === 'addGlobalEventListener' || name === 'removeGlobalEventListener') {
                        expect(typeof target[name]).toBe('function');
                    } else {
                        expect(source).toContain(`window.${name}`);
                    }
                }
            }
        } finally {events.dispose();}
    });

    test("documents the actual virtual stylesheet loader rather than inventing Sass support", () => {
        const source = fs.readFileSync(path.resolve("src/utils/esbuild/plugins/virtual-fs.js"), "utf8");
        expect(source).toContain("build.onLoad({filter: /\\.css$/}");
        expect(source).toContain("compileCssStyleModule(latestContent, args.path)");
        const compiler = fs.readFileSync(path.resolve("src/utils/esbuild/plugins/cssStyleModule.js"), "utf8");
        expect(compiler).toContain("extractCssStyles(latestContent[virtualPath])");
        expect(source).not.toContain("sass.compile");
        expect(PLUGIN_STYLESHEET_CONTRACT.join("\n")).toContain("not a Sass compiler");
        expect(PLUGIN_STYLESHEET_CONTRACT.join("\n")).toContain("extensionless imports are unsupported");
        expect(PLUGIN_STYLESHEET_CONTRACT.join("\n")).toContain("CSS nested rule blocks");
        expect(PLUGIN_STYLESHEET_CONTRACT.join("\n")).toContain('do not copy only its string-valued declarations');
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
        expect(guide).toContain("installed SDK evidence");
        expect(guide).toContain("declarations");
        expect(guide).toContain("repeat validation");
        expect(guide).toContain("attached screenshot is visual evidence");
        expect(guide).toContain("data-bound");
        expect(guide).toContain("PLUGIN STYLESHEET CONTRACT");
        expect(guide).toContain("node:test and node:assert/strict");
        expect(guide).toContain("Do not use React, JSX");
        expect(guide).toContain("import type");
        expect(guide).toContain("A type assertion is not runtime validation");
        expect(guide).toContain("Bundling alone does not establish");
        expect(guide).not.toMatch(/jsonInspectorBound|category\/title|\/features\/seo/);
        expect(guide.length).toBeLessThan(8000);
        expect(guide).toContain("never test typeof css.panel === 'string'");
        expect(guide).toContain('renderBody(dom)');
        expect(guide).toContain('emitted CSS');
        expect(guide).not.toMatch(/src\/ipc|PluginPage\.jsx|settings\.json/);
    });

    test("wraps every CLI coding request with the same public guide", () => {
        const prompt = buildPluginCodingPrompt("Build a JSON Inspector.");
        expect(prompt).toContain("SHARED FDO PLUGIN AUTHORING GUIDE");
        expect(prompt).toContain("Build a JSON Inspector.");
    });

    test("supplies the guide to API system prompts and CLI prompts", () => {
        const source = fs.readFileSync(path.resolve("src/ipc/ai_coding_agent.js"), "utf8");
        expect(source).toContain('reviewReport ? typeof reviewReport === "string" ? reviewReport : WORKSPACE_REVIEW_REPORT_CONTRACT : buildPluginAuthoringGuide()');
        expect(source).toMatch(/const providerPrompt = isCliProvider && !reviewReport\s*\? `\$\{buildPluginCodingPrompt\(prompt\)}\$\{providerInstructions}`\s*: prompt;/);
    });
});
