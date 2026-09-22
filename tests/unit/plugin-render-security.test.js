const { normalizePluginJsxSource, rejectKnownUnsafeRenderPatterns, normalizePluginRenderPayload } = require("../../src/components/plugin/utils/pluginRenderSecurity");

describe("plugin render source guard", () => {
    test.each([
        `throw new Error('Enter JSON or query text to process.');`,
        `const message = "Do not use eval() or window.parent here.";`,
        'const message = `A localStorage tutorial: process.exit() ${1 + 2}`;',
        `// process.exit(1)\n/* window.top */ const count = 1;`,
        String.raw`const pattern = /process.exit|eval\(/;`,
        `<p title="process.exit()">Text to process. localStorage</p>`,
        `const message: string = 'Text to process.';`,
    ])("allows inert text: %s", source => {
        expect(rejectKnownUnsafeRenderPatterns(source)).toBe(source);
    });

    test.each([
        "process.exit(1)", "process /* comment */ . exit(1)",
        "globalThis.document", "eval('1')", "new Function('return 1')",
        "importScripts('worker.js')", "window.parent", "window.top",
        "window.location", "location.assign('/next')", "location.href = '/next'",
        "history.pushState({}, '', '/next')", "window.open('/next')",
        "document.cookie", "localStorage.getItem('key')", "sessionStorage.clear()",
        "navigator.sendBeacon('/next')", "new Worker('worker.js')",
        "new SharedWorker('worker.js')", "new RTCPeerConnection()",
        'const message = `Result: ${process.exit(1)}`;',
        '<p>{process.exit(1)}</p>',
    ])("consistently rejects executable access: %s", source => {
        // Stateful /g regexes used to let the same rejected payload through
        // on a later attempt because lastIndex survived across calls.
        for (let attempt = 0; attempt < 3; attempt++) {
            expect(() => rejectKnownUnsafeRenderPatterns(source)).toThrow(/contains blocked/);
        }
    });

    test("preserves validation of malformed and oversized payloads", () => {
        expect(() => rejectKnownUnsafeRenderPatterns("process.exit(")).toThrow(/blocked/);
        expect(() => rejectKnownUnsafeRenderPatterns(" ".repeat(512 * 1024 + 1))).toThrow(/size limit/);
        expect(() => normalizePluginRenderPayload({render: "not JSON"})).toThrow(/not valid JSON/);
    });

    test("normalizes the workbench message without changing its content", () => {
        const source = `(() => { throw new Error('Enter JSON or query text to process.'); })();`;
        expect(normalizePluginRenderPayload({onLoad: JSON.stringify(source), render: JSON.stringify('<div>Workbench</div>')}))
            .toEqual({onLoad: source, render: '<div>Workbench</div>'});
    });

    test("reports invalid emitted handlers as syntax errors rather than scanning their prose", () => {
        expect(() => normalizePluginRenderPayload({
            onLoad: JSON.stringify(`const handlers = {open: window.tools.open();}; const message = 'Text to process.';`),
            render: JSON.stringify("<div>Tool</div>"),
        })).toThrow(/plugin onLoad source is not valid JavaScript\/TypeScript/);
    });
});

describe("pluginRenderSecurity.normalizePluginJsxSource", () => {
    test("preserves data URI values in inline CSS styles", () => {
        const source = `<div style="background-image: url('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAUAAAAeCAYAAADkftS9AAAAIklEQVQoU2M4c+bMfxAGAgYYmwGrIIiDjrELjpo5aiZeMwF+yNnOs5KSvgAAAABJRU5ErkJggg=='); background-repeat: no-repeat; background-position: center;"></div>`;
        const normalized = normalizePluginJsxSource(source);

        expect(normalized).toContain("backgroundImage: \"url('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAUAAAAeCAYAAADkftS9AAAAIklEQVQoU2M4c+bMfxAGAgYYmwGrIIiDjrELjpo5aiZeMwF+yNnOs5KSvgAAAABJRU5ErkJggg==')\"");
        expect(normalized).toContain("backgroundRepeat: \"no-repeat\"");
        expect(normalized).toContain("backgroundPosition: \"center\"");
    });

    test("converts class and simple style attributes into JSX-safe form", () => {
        const source = `<button class="pure-button" style="margin-top: 10px; color: #fff;"></button>`;
        const normalized = normalizePluginJsxSource(source);

        expect(normalized).toContain('className="pure-button"');
        expect(normalized).toContain("style={{marginTop: \"10px\", color: \"#fff\"}}");
    });
});
