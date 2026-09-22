import {DOM} from "@anikitenko/fdo-sdk";
import {extractCssStyles} from "../../src/components/editor/utils/extractCssStyles";
import {resolveCssImports, mergeCssStyleMaps} from "../../src/components/editor/utils/resolveCssImports";

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

async function compose(files, entry = '/styles.css') {
    const map = extractCssStyles(files[entry]);
    return mergeCssStyleMaps(await resolveCssImports(map, entry, files, extractCssStyles), map);
}

test('composes nested feature CSS without dropping base declarations, states or media rules', async () => {
    const merged = await compose({
        '/styles.css': '@import "./features/text/styles.css"; .panel { color: green; }',
        '/features/text/styles.css': '@import "../../shared/base.css"; .panel { padding: 24px; &:hover { color: blue; } @media (max-width: 600px) { padding: 8px; } }',
        '/shared/base.css': '.panel { color: red; background: white; &:hover { opacity: 0.8; } @media (max-width: 600px) { width: 100%; } }',
    });
    expect(merged).toEqual({panel: {color: 'green', background: 'white', padding: '24px',
        '&:hover': {color: 'blue', opacity: '0.8'}, '@media (max-width: 600px)': {padding: '8px', width: '100%'}}});
    expect(JSON.stringify(merged)).not.toContain('@import');
});

test('shared CSS imports participate in each branch in declaration order', async () => {
    expect(await compose({
        '/styles.css': '@import "./a.css"; @import "./b.css";',
        '/a.css': '@import "./base.css"; .panel { color: green; padding: 4px; }',
        '/b.css': '@import "./base.css"; .panel { margin: 8px; }',
        '/base.css': '.panel { color: red; }',
    })).toEqual({panel: {color: 'red', padding: '4px', margin: '8px'}});
});

test('parses shared dependencies once per resolution without caching stale workspace content', async () => {
    const files = {'/styles.css': '@import "./a.css"; @import "./b.css";',
        '/a.css': '@import "./base.css";', '/b.css': '@import "./base.css";', '/base.css': '.panel { color: red; }'};
    const extract = jest.fn(extractCssStyles);
    const root = extractCssStyles(files['/styles.css']);
    await resolveCssImports(root, '/styles.css', files, extract);
    expect(extract.mock.calls.filter(([source]) => source === files['/base.css'])).toHaveLength(1);
    files['/base.css'] = '.panel { color: green; }';
    expect(await resolveCssImports(root, '/styles.css', files, extract)).toEqual({panel: {color: 'green'}});
});

test('empty imported stylesheets are valid', async () => {
    await expect(compose({'/styles.css': '@import "./empty.css";', '/empty.css': ''})).resolves.toEqual({});
    expect(extractCssStyles('/* An intentionally empty leaf. */')).toEqual({});
});

test('attaches state selectors when their base class comes from another CSS file', async () => {
    expect(await compose({
        '/styles.css': '@import "./base.css"; @import "./states.css";',
        '/base.css': '.panel { padding: 8px; &:hover { opacity: 0.8; } }',
        '/states.css': '.panel:hover { color: green; }',
    })).toEqual({panel: {padding: '8px', '&:hover': {opacity: '0.8', color: 'green'}}});
});

test('missing and circular CSS imports fail with the owning path', async () => {
    await expect(compose({'/styles.css': '@import "./missing.css";'})).rejects.toThrow('CSS import not found: /missing.css (imported by /styles.css)');
    await expect(compose({'/styles.css': '@import "./feature.css";', '/feature.css': '@import "./styles.css";'}))
        .rejects.toThrow('Circular CSS import: /styles.css -> /feature.css -> /styles.css');
});

test.each(['"package.css"', '"./extensionless"', 'url("./local.css")', '"https://example.com/styles.css"', '"./local.css" screen'])(
    'rejects unsupported CSS import syntax instead of silently dropping styles: %s', async value => {
        await expect(compose({'/styles.css': `@import ${value};`})).rejects.toThrow('Unsupported CSS import');
    });
