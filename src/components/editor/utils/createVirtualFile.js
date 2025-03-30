import * as monaco from 'monaco-editor';
import {
    BLANK_TEMPLATE_MAIN, BLANK_TEMPLATE_RENDER,
    HORIZONTAL_DIVIDED_TEMPLATE,
    VERTICAL_DIVIDED_TEMPLATE
} from "./virtualTemplates";
import virtualFS from "./VirtualFS";
import getLanguage from "./getLanguage";

export function createVirtualFile(filePath, content, template = undefined, ignoreModel  = false, plaintext = false) {
    const uri = monaco.Uri.file(`${filePath}`);

    const fileContent = template ? getTemplateContent(filePath, template, content) : content;

    let model = {};
    if (!ignoreModel) {
        model = monaco.editor.getModel(uri);
        if (!model) {
            let language = getLanguage(filePath)
            if (plaintext) language = "plaintext"
            model = monaco.editor.createModel(fileContent, language, uri)
        } else {
            model.setValue(fileContent);
        }
    }

    virtualFS.createFile(filePath, model)
}

function getTemplateContent(file, template, name) {
    let content;
    switch (template) {
        case "blank":
            if (file === virtualFS.DEFAULT_FILE_MAIN) content = BLANK_TEMPLATE_MAIN(name);
            if (file === virtualFS.DEFAULT_FILE_RENDER) content = BLANK_TEMPLATE_RENDER(name);
            break
        case "horDivided":
            content = HORIZONTAL_DIVIDED_TEMPLATE(name);
            break
        case "verDivided":
            content = VERTICAL_DIVIDED_TEMPLATE(name);
            break
        default:
            content = "";
    }
    return content;
}
