import * as monaco from 'monaco-editor';
import {BLANK_TEMPLATE, HORIZONTAL_DIVIDED_TEMPLATE, VERTICAL_DIVIDED_TEMPLATE} from "./virtualTemplates";
import virtualFS from "./VirtualFS";

export function createVirtualFile(filePath, content, template) {
    const uri = monaco.Uri.parse(`file://${filePath}`);

    const fileContent = template ? getTemplateContent(template, content) : content;

    let model = monaco.editor.getModel(uri);
    if (!model) {
        model = monaco.editor.createModel(fileContent, getLanguage(filePath), uri);
    } else {
        model.setValue(fileContent);
    }

    virtualFS.createFile(filePath, model)
}

function getLanguage(filePath) {
    if (filePath.endsWith(".ts") || filePath.endsWith(".tsx")) return "typescript";
    if (filePath.endsWith(".js") || filePath.endsWith(".mjs")) return "javascript";
    if (filePath.endsWith(".json")) return "json";
    if (filePath.endsWith(".md")) return "markdown";
    if (filePath.endsWith(".xml")) return "xml";
    return "plaintext";
}

function getTemplateContent(template, name) {
    if (template === "blank") return BLANK_TEMPLATE(name);
    if (template === "horDivided") return HORIZONTAL_DIVIDED_TEMPLATE(name);
    if (template === "verDivided") return VERTICAL_DIVIDED_TEMPLATE(name);
    return "";
}
