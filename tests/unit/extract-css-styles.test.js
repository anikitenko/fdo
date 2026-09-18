import {DOM} from "@anikitenko/fdo-sdk";
import {extractCssStyles} from "../../src/components/editor/utils/extractCssStyles";
import {resolveCssImports} from "../../src/components/editor/utils/resolveCssImports";

describe("plugin CSS style-map transform", () => {
    test("preserves classes, CSS-style nesting, and keyframes as goober style maps", () => {
        const styles = extractCssStyles(`
            .panel { color: #123; }
            .panel:hover { color: #456; }
            .panel .label { font-weight: 700; }
            .nested { color: #789; &:focus { outline: 2px solid blue; } }
            @keyframes pulse { from { opacity: 0; } to { opacity: 1; } }
        `);

        expect(styles).toEqual({
            panel: {
                color: "#123",
                "&:hover": {color: "#456"},
                " .label": {"font-weight": "700"},
            },
            nested: {
                color: "#789",
                "&:focus": {outline: "2px solid blue"},
            },
            "@keyframes pulse": {
                from: {opacity: "0"},
                to: {opacity: "1"},
            },
        });

        const dom = new DOM();
        const animationStyle = dom.createClassFromStyle(styles["@keyframes pulse"] ? {
            "@keyframes pulse": styles["@keyframes pulse"],
        } : {});
        const panelClass = dom.createClassFromStyle(styles.panel);
        const rendered = dom.renderHTML(`<div class="${animationStyle} ${panelClass}">Panel</div>`);
        expect(rendered).toContain("@keyframes pulse");
        expect(rendered).toContain(`${panelClass}:hover`);
    });

    test("merges quoted relative CSS imports from the workspace", async () => {
        const parent = extractCssStyles('@import "./tokens.css"; .panel { color: #123; }');
        const files = {
            "/styles/panel.css": '@import "./tokens.css"; .panel { color: #123; }',
            "/styles/tokens.css": ".token { color: #456; }",
        };
        const imported = await resolveCssImports(parent, "/styles/panel.css", files, extractCssStyles);

        expect(imported).toEqual({token: {color: "#456"}});
    });
});
