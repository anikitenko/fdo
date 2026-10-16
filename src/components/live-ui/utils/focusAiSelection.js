// Only select source that still matches the host-owned preview. Opening a file
// can mount its Monaco editor asynchronously; recheck ownership on every retry.
export async function focusLiveUiAiSelection({workspace, selection, getEditors, openFile, isActive, wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))}) {
    const {line, column, endLine, endColumn} = selection || {};
    if (![line, column, endLine, endColumn].every(value => Number.isInteger(value) && value > 0)
        || endLine < line || (endLine === line && endColumn <= column) || typeof selection.source !== 'string') return false;
    const range = {startLineNumber: line, startColumn: column, endLineNumber: endLine, endColumn};
    const current = () => {
        if (!isActive() || workspace.aiCodingBusy || workspace.sandboxName !== selection.workspaceId || workspace.fs.getRestoreLoading?.()) return false;
        const file = workspace.files[selection.path];
        if (!file) return false;
        return (file.model && !file.model.isDisposed?.() ? file.model.getValue() : file.content || '') === selection.source;
    };
    if (!current()) return false;
    openFile();
    for (let attempt = 0; attempt < 40; attempt++) {
        if (!current()) return false;
        const editor = getEditors().find(item => item.getModel()?.uri.path === selection.path);
        if (editor) {
            const model = editor.getModel();
            if (model.getValue() !== selection.source) return false;
            const validated = model.validateRange(range);
            if (Object.keys(range).some(key => range[key] !== validated[key])) return false;
            editor.setSelection(range);
            editor.revealRangeInCenter(range);
            editor.focus();
            return true;
        }
        await wait(50);
    }
    return false;
}
