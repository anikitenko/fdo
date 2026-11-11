import {resolveMonacoTypeScriptApi} from './monacoTypeScriptApi';
import {sharedLogicAuthoringCatalog, sharedLogicDeclarations} from '../../../utils/sdk/sharedLogicAuthoring';
import {schemaType} from '../../../utils/plugins/runtime/sharedLogicTypeContract.cjs';

const snippetText = value => value.replace(/[\\$}]/g, character => `\\${character}`);
function methodSnippet(service, method) {
    let tab = 1;
    const placeholder = value => `\${${tab++}:${value}}`;
    const input = schema => {
        if (!schema || schema.type === 'unknown') return placeholder('input');
        if (schema.type === 'object') return '{' + Object.entries(schema.properties)
            .filter(([key]) => schema.required.includes(key))
            .map(([key, value]) => `${snippetText(JSON.stringify(key))}: ${input(value)}`).join(', ') + '}';
        if (schema.type === 'string') return `"${placeholder('')}"`;
        if (schema.type === 'number' || schema.type === 'integer') return placeholder('0');
        if (schema.type === 'boolean') return placeholder('false');
        if (schema.type === 'array') return placeholder('[]');
        return 'null';
    };
    const target = JSON.stringify({providerId: service.providerId, name: service.name, version: service.version});
    return `client(${snippetText(target)}).call(${JSON.stringify(method)}, ${input(service.contract?.[method]?.input)})$0`;
}

export function installSharedLogicMonaco(monaco, fetchCatalog) {
    let disposed = false, pending = false, previous = '', catalog = [];
    let libraries = [];
    const refresh = async () => {
        if (pending || disposed) return;
        pending = true;
        try {
            const result = await fetchCatalog();
            if (disposed || !result?.success) return;
            catalog = sharedLogicAuthoringCatalog(result.services);
            const content = sharedLogicDeclarations(catalog);
            if (content === previous && libraries.length) return;
            // The TypeScript contribution can load after the editor mounts.
            const defaults = resolveMonacoTypeScriptApi(monaco);
            const configs = [defaults?.typescriptDefaults, defaults?.javascriptDefaults].filter(config => config?.addExtraLib);
            if (!configs.length) return;
            previous = content;
            libraries.forEach(item => item?.dispose());
            libraries = configs.map(config => config.addExtraLib(content, 'file:///node_modules/@types/fdo-shared-logic/index.d.ts'));
        } catch {} finally {pending = false;}
    };
    const registrations = ['typescript', 'typescriptreact', 'javascript', 'javascriptreact'].map(language =>
        monaco.languages.registerCompletionItemProvider?.(language, {
            triggerCharacters: ['.'],
            provideCompletionItems(model, position) {
                if (disposed || !position || typeof model?.getLineContent !== 'function' || model.isDisposed?.()) return {suggestions: []};
                const line = model.getLineContent(position.lineNumber).slice(0, position.column - 1);
                if (/^\s*\/\//.test(line) || !/\.shared\.[\w]*$/.test(line)) return {suggestions: []};
                const word = model.getWordUntilPosition?.(position) || {startColumn: position.column, endColumn: position.column};
                const range = {startLineNumber: position.lineNumber, endLineNumber: position.lineNumber, startColumn: word.startColumn, endColumn: word.endColumn};
                return {suggestions: catalog.flatMap(service => {
                    const target = {providerId: service.providerId, name: service.name, version: service.version};
                    const status = service.available ? 'Running' : 'Unavailable — last registered contract';
                    const documentation = `Requires plugins.shared.use and ${service.capability}. Review access in Manage Plugins. ${service.description}`;
                    return [{
                        label: `${service.name} v${service.version} — ${service.providerId}`,
                        filterText: `client ${service.name} ${service.providerId}`,
                        detail: `${status}; methods: ${service.methods.join(', ')}`,
                        documentation, kind: monaco.languages.CompletionItemKind?.Module,
                        insertText: `client(${JSON.stringify(target)})`, range,
                        sortText: `${service.available ? '0' : '1'}:${service.key}:0`,
                    }, ...service.methods.map(method => ({
                        label: `${method} — ${service.name} v${service.version} (${service.providerId})`,
                        filterText: `${method} ${service.name} ${service.providerId}`,
                        detail: `${status}; ${method}(input: ${schemaType(service.contract?.[method]?.input)}) → Promise<${schemaType(service.contract?.[method]?.output)}>`,
                        documentation, kind: monaco.languages.CompletionItemKind?.Method,
                        insertText: methodSnippet(service, method),
                        insertTextRules: monaco.languages.CompletionItemInsertTextRule?.InsertAsSnippet,
                        command: {id: 'editor.action.triggerParameterHints', title: 'Shared method parameters'}, range,
                        sortText: `${service.available ? '0' : '1'}:${service.key}:1:${method}`,
                    }))];
                })};
            },
        }));
    void refresh();
    const timer = setInterval(refresh, 5000);
    return {refresh, dispose() {
        disposed = true; clearInterval(timer);
        libraries.forEach(item => item?.dispose());
        registrations.forEach(item => item?.dispose());
    }};
}
