export const BLANK_TEMPLATE_MAIN = (name) => {
    const data_class_header = `import {defineRenderOnLoadActions, FDO_SDK, FDOInterface, PluginMetadata, PluginRegistry} from '@anikitenko/fdo-sdk';
import {Render} from "./render"

export default class MyPlugin extends FDO_SDK implements FDOInterface {
`
    const data_metadata = `
    private readonly _metadata: PluginMetadata = {
        name: "${name}",
        version: "1.0.0",
        author: "AleXvWaN",
        description: "A sample FDO plugin",
        icon: "cog",
    };

    get metadata(): PluginMetadata {
        return this._metadata;
    }
    `
    const data_init = `
    init(): void {
        PluginRegistry.registerHandler("refreshStatus", () => ({
            success: true,
            message: this.metadata.name + " is running (v" + this.metadata.version + ").",
        }));
        this.info(this.metadata.name + " initialized!", {
            plugin: this.metadata.name,
            version: this.metadata.version,
        });
    }
    `
    const data_render = `
    render(): string {
        const metadata = this.metadata;
        return (Render({
            version: metadata.version,
            author: metadata.author,
            description: metadata.description
        }))
    }
    `
    const data_render_on_load = `
    renderOnLoad() {
        return defineRenderOnLoadActions({
            handlers: {
                refreshStatus: async ({ element }) => {
                    const response = await window.createBackendReq("UI_MESSAGE", {
                        handler: "refreshStatus",
                        content: {
                            plugin: "${name}",
                        },
                    });
                    const target = document.querySelector("[data-role=\\"status\\"]");
                    if (target) {
                        target.textContent = String(response?.message || "Status updated");
                    }
                    if (element instanceof HTMLElement) {
                        element.dataset.state = "ready";
                    }
                },
            },
            bindings: [
                {
                    selector: "[data-role=\\"refresh-status\\"]",
                    event: "click",
                    handler: "refreshStatus",
                    preventDefault: true,
                    required: true,
                },
            ],
            // strict: true surfaces selector mismatch diagnostics early during plugin authoring.
            strict: true,
            language: "typescript",
        });
    }
    `
    const data_class_footer = `
}

new MyPlugin();
`
    return data_class_header + data_metadata + data_init + data_render + data_render_on_load + data_class_footer;
}

export const BLANK_TEMPLATE_RENDER = (name) => {
    const dataImports = "import {DOM, DOMNested, DOMText} from '@anikitenko/fdo-sdk';\n"
    const dataType = "type RenderProps = {\n" +
        "    version: string;\n" +
        "    author: string;\n" +
        "    description: string\n" +
        "}" +
        "\n\n"

    const dataRender = "export const Render = ({ version, author, description }: RenderProps): string => {\n" +
        "    const text = new DOMText();\n" +
        "    const myPlugin = text.createHText(1, `My Plugin`);\n" +
        "    const pVersion = text.createPText(`Version: ${version}`);\n" +
        "    const pAuthor = text.createPText(`Author: ${author}`);\n" +
        "    const pDescription = text.createPText(`Description: ${description}`);\n" +
        "    const refreshButton = new DOM().createElement(\"button\", {\n" +
        "        \"data-role\": \"refresh-status\",\n" +
        "        type: \"button\",\n" +
        "        class: \"pure-button\",\n" +
        "    }, \"Refresh status\");\n" +
        "    const status = new DOM().createElement(\"p\", {\n" +
        "        \"data-role\": \"status\",\n" +
        "    }, \"Click the button to fetch plugin UI status.\");\n" +
        "    const nested = new DOMNested().createBlockDiv([\n" +
        "        myPlugin,\n" +
        "        pVersion,\n" +
        "        pAuthor,\n" +
        "        pDescription,\n" +
        "        refreshButton,\n" +
        "        status\n" +
        "    ]);\n" +
        "    return (\n" +
        "        new DOM().renderHTML(nested)\n" +
        "    )\n" +
        "}"
    return dataImports+ dataType + dataRender
}

export const BLANK_TEMPLATE_TEST = () => `import {test} from "node:test";
import assert from "node:assert/strict";
import {Render} from "./render";

// Run these examples with the editor's Run Tests action.
const props = {version: "2.3.4", author: "Example Author", description: "Example plugin"};

test("renders the plugin details", () => {
    const html = Render(props);
    assert.ok(html.includes("My Plugin"));
    assert.ok(html.includes("Version: 2.3.4"));
    assert.ok(html.includes("Author: Example Author"));
    assert.ok(html.includes("Description: Example plugin"));
});

test("provides the targets used by the refresh action", () => {
    const html = Render(props);
    assert.match(html, /data-role="refresh-status"/);
    assert.match(html, /type="button"/);
    assert.match(html, /data-role="status"/);
    assert.ok(html.includes("Click the button to fetch plugin UI status."));
});
`;

export const HORIZONTAL_DIVIDED_TEMPLATE = (name) => {
    return ``
}

export const VERTICAL_DIVIDED_TEMPLATE = (name) => {
    return ``
}
