import * as monaco from "monaco-editor";
import virtualFS from "./VirtualFS";
import build from "./build";

const codeEditorActions = (codeEditor) => {
    if (!codeEditor) return;
    codeEditor.updateOptions({
        padding: {
            top: 10,
            bottom: 150
        }
    });
    codeEditor.addAction({
        // A unique identifier of the contributed action.
        id: "editor-go-fullscreen",
        // A label of the action that will be presented to the user.
        label: "Open in fullscreen",
        // An optional array of keybindings for the action.
        keybindings: [
            monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyF, // CTRL/CMD + Shift + F
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
    codeEditor.addAction({
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
            virtualFS.openFileDialog({})
        },
    });
    codeEditor.addAction({
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
            await build()
        },
    });
    codeEditor.addAction({
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
    codeEditor.addAction({
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
}

export default codeEditorActions
