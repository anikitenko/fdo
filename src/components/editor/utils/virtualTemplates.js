export const BLANK_TEMPLATE_MAIN = (name) => {
    const data_class_header = `import {FDO_SDK, FDOInterface, PluginMetadata} from '@anikitenko/fdo-sdk';
import {Render} from "./render"

class MyPlugin extends FDO_SDK implements FDOInterface {
`
    const data_metadata = `
    private readonly _metadata: PluginMetadata = {
        name: "${name}",
        version: "1.0.2",
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
    const dataType = "type RenderProps = {\n" +
        "    version: string;\n" +
        "    author: string;\n" +
        "    description: string\n" +
        "}" +
        "\n\n"

    const dataRender = "export const Render = ({ version, author, description }: RenderProps) => {\n" +
        "    return (`\n" +
        "        <div>\n" +
        "            <h1>MyPlugin</h1>\n" +
        "            <p>Version: ${version}</p>\n" +
        "            <p>Author: ${author}</p>\n" +
        "            <p>Description: ${description}</p>\n" +
        "        </div>\n" +
        "    `)\n" +
        "}"
    return dataType + dataRender
}

export const HORIZONTAL_DIVIDED_TEMPLATE = (name) => {
    return ``
}

export const VERTICAL_DIVIDED_TEMPLATE = (name) => {
    return ``
}
