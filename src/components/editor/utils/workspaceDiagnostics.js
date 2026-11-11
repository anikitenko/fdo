import {resolveMonacoTypeScriptApi} from './monacoTypeScriptApi';

const sourcePath = path => typeof path === 'string' && !/^\/(?:node_modules|dist)(?:\/|$)/.test(path) && /\.[cm]?[jt]sx?$/i.test(path);
const messageText = value => typeof value === 'string' ? value : value ? [value.messageText, ...(value.next || []).map(messageText)].filter(Boolean).join('\n') : '';

function diagnosticMarker(monaco, model, diagnostic) {
    const start = model.getPositionAt(diagnostic.start || 0);
    const end = model.getPositionAt((diagnostic.start || 0) + (diagnostic.length || 1));
    const severity = [monaco.MarkerSeverity.Warning, monaco.MarkerSeverity.Error, monaco.MarkerSeverity.Hint, monaco.MarkerSeverity.Info][diagnostic.category] ?? monaco.MarkerSeverity.Info;
    const relatedInformation = (diagnostic.relatedInformation || []).flatMap(info => {
        let related = model;
        if (info.file?.fileName) {
            const name = info.file.fileName;
            related = monaco.editor.getModel(monaco.Uri.parse(name));
            if (!related && name.startsWith('/')) related = monaco.editor.getModel(monaco.Uri.file(name));
        }
        if (!related || related.isDisposed()) return [];
        const start = related.getPositionAt(info.start || 0), end = related.getPositionAt((info.start || 0) + (info.length || 1));
        return [{resource: related.uri, message: messageText(info.messageText), startLineNumber: start.lineNumber, startColumn: start.column, endLineNumber: end.lineNumber, endColumn: end.column}];
    });
    const tags = [];
    if (diagnostic.reportsUnnecessary) tags.push(monaco.MarkerTag.Unnecessary);
    if (diagnostic.reportsDeprecated) tags.push(monaco.MarkerTag.Deprecated);
    return {severity, code: String(diagnostic.code), message: messageText(diagnostic.messageText),
        startLineNumber: start.lineNumber, startColumn: start.column, endLineNumber: end.lineNumber, endColumn: end.column,
        relatedInformation, tags};
}

// Monaco validates an edited model, but does not revalidate its importers.
// Recheck project source on the existing workers after editing settles. Keep
// declarations/dependencies out of the batch and never restart a worker here.
export function installWorkspaceDiagnostics(monaco, workspace, {delay = 300} = {}) {
    let disposed = false, timer, running = false, rerun = false, revision = 0, lastError = '', cancelCurrent;
    const superseded = Symbol('superseded diagnostics');
    const syncTab = filePath => {
        if (disposed || !sourcePath(filePath)) return;
        const tab = workspace.tabs.get().find(tab => tab.id === filePath);
        const model = workspace.files[filePath]?.model;
        if (!tab || !model || model.isDisposed?.()) return;
        // Read all owners, including FDO capability diagnostics. This listener
        // never writes Monaco markers, so it cannot feed back into itself.
        const markers = monaco.editor.getModelMarkers({resource: model.uri});
        if (JSON.stringify(tab.markers || []) === JSON.stringify(markers)) return;
        if (markers.length) workspace.tabs.addMarkers(filePath, markers);
        else workspace.tabs.removeMarkers(filePath);
    };
    const schedule = () => {
        if (disposed) return;
        revision++;cancelCurrent?.();clearTimeout(timer);timer = setTimeout(validate, delay);
    };
    const validate = async () => {
        timer = undefined;
        if (disposed) return;
        if (running) {rerun = true;return;}
        running = true;rerun = false;
        const currentRevision = revision, sandbox = workspace.sandboxName, snapshot = workspace.fs.snapshotSwitchRevision;
        // Creating files changes compiler options and can stop Monaco's old worker
        // without settling its pending requests. A new revision must not wait for it.
        const invalidated = new Promise(resolve => {cancelCurrent = resolve;});
        const waitFor = promise => Promise.race([promise, invalidated.then(() => {throw superseded;})]);
        const models = Object.entries(workspace.files).filter(([path, entry]) => sourcePath(path) && typeof entry.model?.getVersionId === 'function' && !entry.model.isDisposed())
            .map(([path, entry]) => ({path, model: entry.model, version: entry.model.getVersionId(), language: entry.model.getLanguageId()}));
        const current = () => !disposed && revision === currentRevision && workspace.sandboxName === sandbox && workspace.fs.snapshotSwitchRevision === snapshot
            && models.every(item => workspace.files[item.path]?.model === item.model && !item.model.isDisposed() && item.model.getVersionId() === item.version);
        try {
            const api = resolveMonacoTypeScriptApi(monaco);
            const results = [];
            for (const language of ['typescript', 'javascript']) {
                const group = models.filter(item => item.language === language);
                const getter = language === 'typescript' ? api?.getTypeScriptWorker : api?.getJavaScriptWorker;
                if (!group.length || typeof getter !== 'function') continue;
                const defaults = language === 'typescript' ? api.typescriptDefaults : api.javascriptDefaults;
                const options = defaults?.getDiagnosticsOptions?.() || {};
                const factory = await waitFor(getter());
                if (!current()) return;
                const worker = await waitFor(factory(...group.map(item => item.model.uri)));
                for (const item of group) {
                    if (!current()) return;
                    const fileName = item.model.uri.toString();
                    const diagnostics = (await waitFor(Promise.all([
                        options.noSyntaxValidation ? [] : worker.getSyntacticDiagnostics(fileName),
                        options.noSemanticValidation ? [] : worker.getSemanticDiagnostics(fileName),
                        options.noSuggestionDiagnostics || !worker.getSuggestionDiagnostics ? [] : worker.getSuggestionDiagnostics(fileName),
                    ]))).flat().filter(diagnostic => !(options.diagnosticCodesToIgnore || []).includes(diagnostic.code));
                    results.push({item, markers: diagnostics.map(diagnostic => diagnosticMarker(monaco, item.model, diagnostic))});
                }
            }
            if (!current()) return;
            for (const {item, markers} of results) monaco.editor.setModelMarkers(item.model, item.language, markers);
            for (const item of models) syncTab(item.path);
            lastError = '';
        } catch (error) {
            if (error === superseded) return;
            const message = error?.message || String(error);
            if (!disposed && message !== lastError) {lastError = message;console.warn('[Editor] Workspace diagnostics refresh failed:', message);}
        } finally {
            running = false;cancelCurrent = undefined;
            if (!disposed && (rerun || revision !== currentRevision)) {clearTimeout(timer);timer = setTimeout(validate, delay);}
        }
    };
    const sourceChanged = value => {
        const path = typeof value === 'string' ? value : value?.id;
        if (sourcePath(path)) schedule();
    };
    const subscriptions = [
        ...['fileContentChanged', 'fileCreated', 'fileRemoved'].map(event => workspace.notifications.subscribe(event, sourceChanged)),
        ...['workspacePathsChanged', 'snapshotSwitched'].map(event => workspace.notifications.subscribe(event, schedule)),
        workspace.notifications.subscribe('fileTabs', () => workspace.tabs.get().forEach(tab => syncTab(tab.id))),
    ];
    const markerListener = monaco.editor.onDidChangeMarkers?.(resources => resources.forEach(uri => syncTab(uri.path)));
    schedule();
    return {dispose() {
        disposed = true;revision++;cancelCurrent?.();clearTimeout(timer);
        subscriptions.forEach(unsubscribe => unsubscribe());markerListener?.dispose();
    }};
}
