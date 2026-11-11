import * as monaco from 'monaco-editor';
import {createPluginTemplateFiles} from './virtualTemplates';
import virtualFS from "./VirtualFS";
import getLanguage from "./getLanguage";
import {normalizeVirtualWorkspacePath} from '../../../utils/plugins/virtualWorkspacePaths';

export function createVirtualFile(filePath, content, template = undefined, ignoreModel  = false, plaintext = false, displayName = undefined, options = undefined) {
    filePath = normalizeVirtualWorkspacePath(filePath);
    const uri = monaco.Uri.file(`${filePath}`);

    const fileContent = template ? getTemplateContent(filePath, template, displayName || content) : content;

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

    virtualFS.createFile(filePath, model, options)
}

function getTemplateContent(file, template, name) {
    const content = createPluginTemplateFiles({name, template})[file];
    if (content === undefined) throw new Error(`Template ${template} does not define ${file}.`);
    return content;
}
