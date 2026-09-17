export const BLANK_TEMPLATE_MAIN = (name) => {
    const data_class_header = `import {defineRenderOnLoadActions, FDO_SDK, FDOInterface, PluginMetadata} from '@anikitenko/fdo-sdk';
import {Render} from "./render"

class MyPlugin extends FDO_SDK implements FDOInterface {
`
    const data_metadata = `
    public get metadata(): PluginMetadata {
        return {
            name: "${name}",
            version: "1.0.0",
            author: "AleXvWaN",
            description: "A sample FDO plugin",
            icon: "cog",
        };
    }
    `
    const data_init = `
    public init(): void {
        this.log(this.metadata.name + " initialized!");
    }
    `
    const data_render = `
    public render(): string {
        const metadata = this.metadata;
        return (Render({
            version: metadata.version,
            author: metadata.author,
            description: metadata.description
        }))
    }
    `
    const data_render_on_load = `
    public renderOnLoad() {
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
export default MyPlugin;

new MyPlugin();
`
    return data_class_header + data_metadata + data_init + data_render + data_render_on_load + data_class_footer;
}

export const BLANK_TEMPLATE_RENDER = (name) => {
    const dataImports = "import {DOM, DOMButton, DOMNested, DOMText} from '@anikitenko/fdo-sdk';\n"
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
        "    const refreshButton = new DOMButton().createButton(\"Refresh status\", {\n" +
        "        attrs: {\n" +
        "            \"data-role\": \"refresh-status\",\n" +
        "            type: \"button\",\n" +
        "        },\n" +
        "    });\n" +
        "    const status = text.createPText(\"Click the button to fetch plugin UI status.\", {\n" +
        "        attrs: {\n" +
        "            \"data-role\": \"status\",\n" +
        "        },\n" +
        "    });\n" +
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

export const HORIZONTAL_DIVIDED_TEMPLATE = (name) => {
    return ``
}

export const VERTICAL_DIVIDED_TEMPLATE = (name) => {
    return ``
}
