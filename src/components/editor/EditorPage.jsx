import {useLocation} from "react-router-dom";
import Split from "react-split-grid";
import * as monaco from 'monaco-editor';
import {Editor, loader} from '@monaco-editor/react';

import styles from './EditorPage.module.css'
import {useEffect, useState} from "react";
import {Button, InputGroup} from "@blueprintjs/core";
import {FDO_SDK} from "@anikitenko/fdo-sdk";
import {setupVirtualWorkspace} from "./utils/setupVirtualWorkspace";
import virtualFS from "./utils/VirtualFS";
import {packageDefaultContent} from "./utils/packageDefaultContent";
import FileBrowserComponent from "./FileBrowserComponent";
import FileTabs from "./FileTabComponent";
import FileDialogComponent from "./FileDialogComponent";
import CodeDeployActions from "./CodeDeployActions";

export const EditorPage = () => {
    document.title = "Plugin Editor";
    loader.config({monaco});

    const location = useLocation();
    // Extract data from the query parameter
    const searchParams = new URLSearchParams(location.search);
    const pluginData = JSON.parse(decodeURIComponent(searchParams.get("data") || "{}"));
    const rootFolder = FDO_SDK.generatePluginName(pluginData.name)
    const pluginTemplate = pluginData.template
    const [editorModelPath, setEditorModelPath] = useState(virtualFS.getTreeObjectItemSelected()?.id)
    const [codeEditorCreated, setCodeEditorCreated] = useState(false)
    const [codeEditor, setCodeEditor] = useState(null)
    const [jumpTo, setJumpTo] = useState(null)
    const closeTab = (fileID) => {
        if (virtualFS.getModel(fileID))
            virtualFS.updateModelState(fileID, codeEditor.saveViewState())
        virtualFS.tabs.removeById(fileID)
    }

    monaco.editor.onDidCreateEditor(async () => {
        if (!codeEditorCreated) {
            await setupVirtualWorkspace(rootFolder, pluginTemplate)
            monaco.editor.registerEditorOpener({
                openCodeEditor(source, resource, selectionOrPosition) {
                    setJumpTo({
                        id: resource.toString().replace("file://", "").replace("%40", "@"),
                        options: {
                            selection: selectionOrPosition
                        }
                    })
                    return true;
                }
            });
            setCodeEditorCreated(true)
        }
    })

    useEffect(() => {
        if (!codeEditor) return;
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
            contextMenuOrder: 1.5,

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
            contextMenuGroupId: "navigation",
            contextMenuOrder: 1.5,

            // Method that will be executed when the action is triggered.
            // @param editor The editor instance is passed in as a convenience
            run: function (ed) {
                ed.focus()
                virtualFS.openFileDialog({})
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
            contextMenuGroupId: "navigation",
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
            contextMenuGroupId: "navigation",
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
    }, [codeEditor]);

    useEffect(() => {
        if (jumpTo) {
            if (jumpTo.id) {
                if (!virtualFS.getModel(jumpTo.id)) return
                virtualFS.setTreeObjectItemBool(jumpTo.id, "isSelected")
                setTimeout(() => {
                    codeEditor.setSelection(jumpTo.options.selection);
                    codeEditor.revealLine(jumpTo.options.selection.startLineNumber)
                }, 200)
            }
        }
    }, [jumpTo]);

    function handleEditorChange(value) {
        /*const path = selectedFile.id;
        if (path === "Untitled") {
            return
        }*/
    }

    const openCodePaletteShow = () => {
        codeEditor.focus();
        codeEditor.trigger("", "editor.action.quickCommand", "");
        const input = document.querySelector(".quick-input-box .input");
        input.value = "";
        input.dispatchEvent(new Event("input", {bubbles: true}));
    }

    const updatePaletteLeft = () => {
        const inputElement = document.getElementsByClassName(styles["editor-header-search"]);
        if (inputElement) {
            const rect = inputElement[0].getBoundingClientRect();
            document.documentElement.style.setProperty("--palette-left", `50+${rect.left}px`);
        }
    };

    useEffect(() => {
        window.addEventListener("resize", updatePaletteLeft);
        updatePaletteLeft(); // Initial update

        const unsubscribe = virtualFS.notifications.subscribe("fileSelected", (file) => {
            if (file) {
                virtualFS.tabs.add(file);
                setEditorModelPath(file.id)
                codeEditor?.setModel(virtualFS.getModel(file.id))
                codeEditor?.restoreViewState(virtualFS.getModelState(file.id))
            }
        });
        const unsubscribeFileRemoved = virtualFS.notifications.subscribe("fileRemoved", (fileID) => {
            virtualFS.tabs.removeById(fileID)
            virtualFS.tabs.switchToLast()
        });
        const unsubscribeTabSwitched = virtualFS.notifications.subscribe("tabSwitched", (tabID) => {
            setTimeout(() => {
                setEditorModelPath(tabID)
                virtualFS.setTreeObjectItemSelectedSilent(tabID)
            }, 100)
        });

        return () => {
            window.removeEventListener("resize", updatePaletteLeft)
            unsubscribe()
            unsubscribeFileRemoved()
            unsubscribeTabSwitched()
        }
    }, []);

    return (
        <div id={"editor-page-component"}>
            <div className={styles["editor-header"]}>
                <div className={styles["editor-header-left"]}>
                    <Button icon="arrow-left" minimal={true}
                            disabled={virtualFS.tabs.get().length <= 1}
                            onClick={() => virtualFS.tabs.setActiveTabLeft()}
                            aria-label="arrow-left"/>
                    <Button icon="arrow-right" minimal={true}
                            disabled={virtualFS.tabs.get().length <= 1}
                            onClick={() => virtualFS.tabs.setActiveTabRight()}
                            aria-label="arrow-right"/>
                </div>
                <div className={styles["editor-header-center"]}>
                    <InputGroup
                        leftIcon={"search"}
                        placeholder={virtualFS.getTreeObjectItemSelected()?.label}
                        round={true} fill={true} small={true}
                        inputClassName={styles["editor-header-search"]} onClick={() => openCodePaletteShow()}
                    />
                </div>
                <div className={styles["editor-header-right"]}>Right Content</div>
            </div>
            <Split
                minSize={250}
                render={({
                             getGridProps,
                             getGutterProps,
                         }) => (
                    <div className={`bp5-dark ${styles["grid-container"]}`} {...getGridProps()}>
                        <div className={styles["file-explorer"]}>
                            <Split
                                minSize={100}
                                direction="column"
                                render={({
                                             getGridProps: getInnerGridProps,
                                             getGutterProps: getInnerGutterProps,
                                         }) => (
                                    <div {...getInnerGridProps()} className={styles["inner-files-deploy-grid"]}>
                                        <div>
                                            <FileBrowserComponent/>
                                        </div>
                                        <div className={styles["gutter-row"]} {...getInnerGutterProps('row', 1)}></div>
                                        <div>
                                            <div className={styles["code-deploy-actions"]}>
                                                <CodeDeployActions/>
                                            </div>
                                        </div>
                                    </div>
                                )}
                            />
                        </div>
                        <div className={styles["gutter-col"]} {...getGutterProps('column', 1)}></div>
                        <div>
                            <Split
                                minSize={200}
                                direction="column"
                                render={({
                                             getGridProps: getInnerGridProps,
                                             getGutterProps: getInnerGutterProps,
                                         }) => (
                                    <div {...getInnerGridProps()} id={"code-editor"} className={styles["inner-editor-terminal-grid"]}>
                                        <div className={styles["code-editor"]}>
                                            <FileTabs closeTab={closeTab}/>
                                            <Editor height="100vh" defaultLanguage="plaintext"
                                                    onChange={handleEditorChange}
                                                    theme="vs-dark"
                                                    defaultValue={packageDefaultContent(rootFolder)}
                                                    path={editorModelPath}
                                                    className={styles["editor-container"]}
                                                    onMount={(editor) => {
                                                        setCodeEditor(editor)
                                                    }}
                                                    options={{
                                                        minimap: {enabled: true},
                                                        scrollbar: {vertical: "hidden", horizontal: "auto"},
                                                        fontSize: 13,
                                                        extraEditorClassName: styles["monaco-main-editor"]
                                                    }}
                                            />
                                        </div>
                                        <div className={styles["gutter-row"]} {...getInnerGutterProps('row', 1)}></div>
                                        <div>
                                            <div className={styles["terminal-output-console"]}>
                                                dffdbmfdbmdfobmdfbodfmbofdmbfd
                                            </div>
                                        </div>
                                    </div>
                                )}
                            />
                        </div>
                    </div>
                )}
            />
            <FileDialogComponent/>
        </div>
    );
}