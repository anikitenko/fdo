import {
    isAllowedPluginExternalUrl,
    isTrustedParentPluginEvent,
    isTrustedPluginFrameEvent,
    normalizePluginJsxSource,
    isValidPluginUiRequestMessage,
    normalizePluginRenderPayload,
    rejectKnownUnsafeRenderPatterns,
} from "../../src/components/plugin/utils/pluginRenderSecurity";

describe("plugin render security helpers", () => {
    test("normalizes valid serialized render payload", () => {
        const payload = normalizePluginRenderPayload({
            render: JSON.stringify("<div>Hello</div>"),
            onLoad: JSON.stringify("() => {}"),
        });

        expect(payload.render).toBe("<div>Hello</div>");
        expect(payload.onLoad).toBe("() => {}");
    });

    test("defaults missing onLoad to a null handler payload", () => {
        const payload = normalizePluginRenderPayload({
            render: JSON.stringify("<div>Hello</div>"),
        });

        expect(payload.render).toBe("<div>Hello</div>");
        expect(payload.onLoad).toBe("null");
    });

    test("normalizes HTML-like class and style attributes for the React-hosted plugin pipeline", () => {
        const normalized = normalizePluginJsxSource('<div class="hero" style="margin-top: 4px; color: red; --accent-color: #fff">Hello</div>');

        expect(normalized).toContain('className="hero"');
        expect(normalized).toContain('style={{marginTop: "4px", color: "red", "--accent-color": "#fff"}}');
    });

    test("rejects obvious fail-fast dangerous patterns", () => {
        expect(() => rejectKnownUnsafeRenderPatterns("process.env.SECRET")).toThrow(/real security boundary/i);
        expect(() => rejectKnownUnsafeRenderPatterns("window.parent.postMessage({})")).toThrow(/real security boundary/i);
        expect(() => rejectKnownUnsafeRenderPatterns("window.location = '/'")).toThrow(/programmatic navigation/i);
        expect(() => rejectKnownUnsafeRenderPatterns("location.assign('/')")).toThrow(/programmatic navigation/i);
        expect(() => rejectKnownUnsafeRenderPatterns("history.pushState({}, '', '/')")).toThrow(/history navigation/i);
    });

    test("rejects invalid serialized payload shapes", () => {
        expect(() => normalizePluginRenderPayload({ render: "{}", onLoad: JSON.stringify("() => {}") })).toThrow(/must decode to a string/i);
        expect(() => normalizePluginRenderPayload({ onLoad: JSON.stringify("() => {}") })).toThrow(/must be a JSON string/i);
    });

    test("accepts only http and https plugin external links", () => {
        expect(isAllowedPluginExternalUrl("https://example.com")).toBe(true);
        expect(isAllowedPluginExternalUrl("http://example.com")).toBe(true);
        expect(isAllowedPluginExternalUrl("javascript:alert(1)")).toBe(false);
        expect(isAllowedPluginExternalUrl("file:///tmp/test")).toBe(false);
        expect(isAllowedPluginExternalUrl("not-a-url")).toBe(false);
    });

    test("requires the expected message source for iframe and parent events", () => {
        const iframeWindow = {};
        const parentWindow = {};
        const validEvent = { source: iframeWindow, data: { type: "PLUGIN_HELLO" } };
        const invalidEvent = { source: {}, data: { type: "PLUGIN_HELLO" } };

        expect(isTrustedPluginFrameEvent(validEvent, iframeWindow)).toBe(true);
        expect(isTrustedPluginFrameEvent(invalidEvent, iframeWindow)).toBe(false);
        expect(isTrustedParentPluginEvent({ source: parentWindow, data: { type: "PLUGIN_RENDER" } }, parentWindow)).toBe(true);
        expect(isTrustedParentPluginEvent({ source: iframeWindow, data: { type: "PLUGIN_RENDER" } }, parentWindow)).toBe(false);
    });

    test("validates plugin UI request payload shape", () => {
        expect(isValidPluginUiRequestMessage({ handler: "save", content: { ok: true } })).toBe(true);
        expect(isValidPluginUiRequestMessage({ handler: "", content: {} })).toBe(false);
        expect(isValidPluginUiRequestMessage({ content: {} })).toBe(false);
    });
});
