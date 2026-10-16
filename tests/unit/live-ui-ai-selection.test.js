import {focusLiveUiAiSelection} from '../../src/components/live-ui/utils/focusAiSelection';

function setup() {
    const source = 'const label = "Preview";';
    const selection = {workspaceId: 'workspace', path: '/render.ts', source, line: 1, column: 7, endLine: 1, endColumn: 12};
    const workspace = {sandboxName: 'workspace', files: {'/render.ts': {content: source}}, fs: {getRestoreLoading: () => false}};
    const model = {uri: {path: '/render.ts'}, getValue: () => source, validateRange: range => range};
    const editor = {getModel: () => model, setSelection: jest.fn(), revealRangeInCenter: jest.fn(), focus: jest.fn()};
    const options = {workspace, selection, getEditors: () => [editor], openFile: jest.fn(), isActive: () => true, wait: jest.fn(async () => {})};
    return {options, editor, model};
}

test('selects the exact mapped source without editing it or submitting an AI request', async () => {
    const {options, editor} = setup();
    await expect(focusLiveUiAiSelection(options)).resolves.toBe(true);
    expect(options.openFile).toHaveBeenCalledTimes(1);
    expect(editor.setSelection).toHaveBeenCalledWith({startLineNumber: 1, startColumn: 7, endLineNumber: 1, endColumn: 12});
    expect(editor.focus).toHaveBeenCalledTimes(1);
    expect(options.workspace.files['/render.ts'].content).toBe(options.selection.source);
});

test.each(['workspace', 'source', 'restore', 'unmount', 'range', 'model', 'active request'])('rejects a %s mismatch before focusing the assistant', async reason => {
    const {options, editor, model} = setup();
    if (reason === 'workspace') options.workspace.sandboxName = 'another';
    if (reason === 'source') options.workspace.files['/render.ts'].content += '// changed';
    if (reason === 'restore') options.workspace.fs.getRestoreLoading = () => true;
    if (reason === 'unmount') options.isActive = () => false;
    if (reason === 'range') model.validateRange = range => ({...range, endColumn: 10});
    if (reason === 'model') model.getValue = () => 'New editor source';
    if (reason === 'active request') options.workspace.aiCodingBusy = true;
    await expect(focusLiveUiAiSelection(options)).resolves.toBe(false);
    expect(editor.setSelection).not.toHaveBeenCalled();
});

test('waits for the requested editor and rechecks source while it mounts', async () => {
    const {options, editor} = setup();
    let ready = false;
    options.getEditors = () => ready ? [editor] : [];
    options.wait = async () => {ready = true;};
    await expect(focusLiveUiAiSelection(options)).resolves.toBe(true);
    ready = false;
    options.wait = async () => {options.workspace.files['/render.ts'].content += '// changed while mounting';};
    editor.setSelection.mockClear();
    await expect(focusLiveUiAiSelection(options)).resolves.toBe(false);
    expect(editor.setSelection).not.toHaveBeenCalled();
});

test('stops waiting when no matching Monaco editor mounts', async () => {
    const {options, editor} = setup();
    options.getEditors = () => [];
    await expect(focusLiveUiAiSelection(options)).resolves.toBe(false);
    expect(options.wait).toHaveBeenCalledTimes(40);
    expect(editor.setSelection).not.toHaveBeenCalled();
});
