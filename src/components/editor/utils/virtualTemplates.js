export const BLANK_TEMPLATE = (name) => {
    const data_class_header = `import {FDO_SDK, FDOInterface, PluginMetadata} from '@anikitenko/fdo-sdk';

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
    public init(sdk: FDO_SDK): void {
        sdk.log("MyPlugin initialized!");
    }
    `
    const data_render = "" +
        "   public render(): string {\n" +
        "        return (`\n" +
        "           <div>\n" +
        "                <h1>MyPlugin</h1>\n" +
        "                <p>Version: ${this._metadata.version}</p>\n" +
        "                <p>Author: ${this._metadata.author}</p>\n" +
        "                <p>Description: ${this._metadata.description}</p>\n" + "" +
        "            </div>\n" +
        "        `)\n" +
        "    }"
    const data_class_footer = `
}
export default MyPlugin;

new MyPlugin();
`
    return data_class_header + data_metadata + data_constructor + data_get_metadata + data_init + data_render + data_class_footer;
}

export const HORIZONTAL_DIVIDED_TEMPLATE = (name) => {
    return ``
}

export const VERTICAL_DIVIDED_TEMPLATE = (name) => {
    return ``
}
