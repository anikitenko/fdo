import codeEditorActions from '../../src/components/editor/utils/codeEditorActions';
import build from '../../src/components/editor/utils/build';
jest.mock('monaco-editor', () => ({KeyMod: {CtrlCmd: 1, Shift: 2}, KeyCode: {KeyF: 3, KeyN: 4, KeyB: 5, LeftArrow: 6, RightArrow: 7}}));
jest.mock('../../src/components/editor/utils/build', () => jest.fn().mockResolvedValue({success: true}));

test('keyboard/context-menu Compile reveals the Build output before compilation', async () => {
    const actions = [];
    const editor = {updateOptions: jest.fn(), addAction: action => actions.push(action), focus: jest.fn()};
    const onCompile = jest.fn();
    codeEditorActions(editor, {onCompile});
    await actions.find(action => action.id === 'compile-plugin').run(editor);
    expect(onCompile).toHaveBeenCalledTimes(1);
    expect(build).toHaveBeenCalledTimes(1);
    expect(onCompile.mock.invocationCallOrder[0]).toBeLessThan(build.mock.invocationCallOrder[0]);
});
