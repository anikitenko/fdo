import * as monaco from "monaco-editor";
import virtualFS from "./VirtualFS";
import build from "./build";

const codeEditorActions = (codeEditor, {onCompile} = {}) => {
    if (!codeEditor) return;
    const registrations = [];
    const addAction = action => registrations.push(codeEditor.addAction(action));
    codeEditor.updateOptions({
        padding: {
            top: 10,
            bottom: 150
        }
    });
    addAction({
        // A unique identifier of the contributed action.
        id: "editor-go-fullscreen",
        // A label of the action that will be presented to the user.
        label: "Open in fullscreen",
        // An optional array of keybindings for the action.
        keybindings: [
            monaco.KeyMod.CtrlCmd | monaco.KeyMod.Alt | monaco.KeyCode.KeyF, // CTRL/CMD + Alt + F
        ],
        // A precondition for this action.
        precondition: null,
        // A rule to evaluate on top of the precondition in order to dispatch the keybindings.
        keybindingContext: null,
        contextMenuGroupId: "navigation",
        contextMenuOrder: 1,

        // Method that will be executed when the action is triggered.
        // @param editor The editor instance is passed in as a convenience
        run: function (ed) {
            ed.focus()
            let itm = document.getElementById("code-editor");
            if (itm.requestFullscreen) {
                itm.requestFullscreen().then(() => ({}));

            }
        },
    });
    addAction({
        // A unique identifier of the contributed action.
        id: "new-file",
        // A label of the action that will be presented to the user.
        label: "New file",
        // An optional array of keybindings for the action.
        keybindings: [
            monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyN, // CTRL/CMD + N
        ],
        // A precondition for this action.
        precondition: null,
        // A rule to evaluate on top of the precondition in order to dispatch the keybindings.
        keybindingContext: null,
        contextMenuGroupId: "1_modification",
        contextMenuOrder: 1,

        // Method that will be executed when the action is triggered.
        // @param editor The editor instance is passed in as a convenience
        run: function (ed) {
            ed.focus()
            virtualFS.openFileDialog({node: virtualFS.getTreeObjectItemById(virtualFS.tabs.getActiveTabId())})
        },
    });
    addAction({
        // A unique identifier of the contributed action.
        id: "compile-plugin",
        // A label of the action that will be presented to the user.
        label: "Compile plugin",
        // An optional array of keybindings for the action.
        keybindings: [
            monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyB,
        ],
        // A precondition for this action.
        precondition: null,
        // A rule to evaluate on top of the precondition in order to dispatch the keybindings.
        keybindingContext: null,
        contextMenuGroupId: "1_modification",
        contextMenuOrder: 2,

        // Method that will be executed when the action is triggered.
        // @param editor The editor instance is passed in as a convenience
        run: async function (ed) {
            ed.focus()
            onCompile?.();
            await build()
        },
    });
    addAction({
        // A unique identifier of the contributed action.
        id: "switch-tab-left",
        // A label of the action that will be presented to the user.
        label: "Switch tab left",
        // An optional array of keybindings for the action.
        keybindings: [
            monaco.KeyMod.WinCtrl | monaco.KeyMod.CtrlCmd | monaco.KeyCode.LeftArrow,
        ],
        // A precondition for this action.
        precondition: null,
        // A rule to evaluate on top of the precondition in order to dispatch the keybindings.
        keybindingContext: null,
        contextMenuGroupId: null,
        contextMenuOrder: 1.5,

        // Method that will be executed when the action is triggered.
        // @param editor The editor instance is passed in as a convenience
        run: function (ed) {
            ed.focus()
            setTimeout(() => {
                virtualFS.tabs.setActiveTabLeft()
            }, 50)
        },
    });
    addAction({
        // A unique identifier of the contributed action.
        id: "switch-tab-right",
        // A label of the action that will be presented to the user.
        label: "Switch tab right",
        // An optional array of keybindings for the action.
        keybindings: [
            monaco.KeyMod.WinCtrl | monaco.KeyMod.CtrlCmd | monaco.KeyCode.RightArrow,
        ],
        // A precondition for this action.
        precondition: null,
        // A rule to evaluate on top of the precondition in order to dispatch the keybindings.
        keybindingContext: null,
        contextMenuGroupId: null,
        contextMenuOrder: 1.5,

        // Method that will be executed when the action is triggered.
        // @param editor The editor instance is passed in as a convenience
        run: function (ed) {
            ed.focus()
            setTimeout(() => {
                virtualFS.tabs.setActiveTabRight()
            }, 50)
        },
    });
    addAction({
        id: 'new-directory', label: 'New directory',
        keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyMod.Alt | monaco.KeyCode.KeyN],
        run: () => virtualFS.openFileDialog({node: virtualFS.getTreeObjectItemById(virtualFS.tabs.getActiveTabId()), type: 'folder'}),
    });
    addAction({
        id: 'rename-project-file', label: 'Rename file and update imports',
        keybindings: [monaco.KeyMod.Shift | monaco.KeyCode.F6],
        run: () => {
            const node = virtualFS.getTreeObjectItemById(virtualFS.tabs.getActiveTabId());
            if (node && !/^\/(?:node_modules|dist)(?:\/|$)/.test(node.id) && node.id !== '/package.json') virtualFS.openFileDialog({node, action: 'rename'});
        },
    });
    return () => registrations.forEach(registration => registration?.dispose?.());

}

export default codeEditorActions
