const { normalizePluginJsxSource } = require("../../src/components/plugin/utils/pluginRenderSecurity");

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
