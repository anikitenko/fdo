import * as monaco from 'monaco-editor';
import {BLANK_TEMPLATE, HORIZONTAL_DIVIDED_TEMPLATE, VERTICAL_DIVIDED_TEMPLATE} from "./virtualTemplates";
import virtualFS from "./VirtualFS";
import getLanguage from "./getLanguage";

export function createVirtualFile(filePath, content, template = undefined, ignoreModel  = false) {
    const uri = monaco.Uri.parse(`file://${filePath}`);

    const fileContent = template ? getTemplateContent(template, content) : content;

    let model = {};
    if (!ignoreModel) {
        model = monaco.editor.getModel(uri);
        if (!model) {
            model = monaco.editor.createModel(fileContent, getLanguage(filePath), uri);
        } else {
            model.setValue(fileContent);
        }
    }

    virtualFS.createFile(filePath, model)
}

function getTemplateContent(template, name) {
    if (template === "blank") return BLANK_TEMPLATE(name);
    if (template === "horDivided") return HORIZONTAL_DIVIDED_TEMPLATE(name);
    if (template === "verDivided") return VERTICAL_DIVIDED_TEMPLATE(name);
    return "";
}
