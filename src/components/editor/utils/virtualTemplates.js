export const BLANK_TEMPLATE_MAIN = (name) => {
    const data_class_header = `import {FDO_SDK, FDOInterface, PluginMetadata} from '@anikitenko/fdo-sdk';
import {Render} from "./render"

class MyPlugin extends FDO_SDK implements FDOInterface {
`
    const data_metadata = `
    private readonly _metadata: PluginMetadata = {
        name: "${name}",
        version: "1.0.0",
        author: "AleXvWaN",
        description: "A sample FDO plugin",
        icon: "COG",
    };`
    const data_constructor = `
    constructor() {
        super();
    }
    `
    const data_get_metadata = `
    public get metadata(): PluginMetadata {
        return this._metadata;
    }
    `
    const data_init = `
    public init(): void {
        this.log("MyPlugin initialized!");
    }
    `
    const data_render = `
    public render(): string {
        return (Render({
            version: this._metadata.version,
            author: this._metadata.author,
            description: this._metadata.description
        }))
    }
    `
    const data_class_footer = `
}
export default MyPlugin;

new MyPlugin();
`
    return data_class_header + data_metadata + data_constructor + data_get_metadata + data_init + data_render + data_class_footer;
}

export const BLANK_TEMPLATE_RENDER = (name) => {
    const dataImports = "import {DOM, DOMText, DOMNested} from '@anikitenko/fdo-sdk';\n"
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
        "    const nested = new DOMNested().createBlockDiv([\n" +
        "        myPlugin,\n" +
        "        pVersion,\n" +
        "        pAuthor,\n" +
        "        pDescription\n" +
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
