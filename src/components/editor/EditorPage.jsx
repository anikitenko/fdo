import {useLocation} from "react-router-dom";
import Split from "react-split-grid";
import * as monaco from 'monaco-editor';
import {Editor, loader} from '@monaco-editor/react';

import * as styles from './EditorPage.module.css'
import {useEffect, useState} from "react";
import {Button, InputGroup} from "@blueprintjs/core";
import {setupVirtualWorkspace} from "./utils/setupVirtualWorkspace";
import virtualFS from "./utils/VirtualFS";
import {packageDefaultContent} from "./utils/packageDefaultContent";
import FileBrowserComponent from "./FileBrowserComponent";
import FileTabs from "./FileTabComponent";
import FileDialogComponent from "./FileDialogComponent";
import CodeDeployActions from "./CodeDeployActions";
import codeEditorActions from "./utils/codeEditorActions";
import monacoEditorStyle from "./monacoEditorStyle";
import BuildOutputTerminalComponent from "./BuildOutputTerminalComponent";
import generatePluginName from "./utils/generatePluginName";

export const EditorPage = () => {
    document.title = "Plugin Editor";
    loader.config({monaco});

    const location = useLocation();
    // Extract data from the query parameter
    const searchParams = new URLSearchParams(location.search);
    const pluginData = JSON.parse(decodeURIComponent(searchParams.get("data") || "{}"));
    const rootFolder = generatePluginName(pluginData.name)
    const pluginTemplate = pluginData.template
    const [editorModelPath, setEditorModelPath] = useState(virtualFS.getTreeObjectItemSelected()?.id)
    const [codeEditorCreated, setCodeEditorCreated] = useState(false)
    const [codeEditor, setCodeEditor] = useState(null)
    const [jumpTo, setJumpTo] = useState(null)
    const [buildOutputSelectedTabId, setBuildOutputSelectedTabId] = useState("problems")
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

    useEffect(() => codeEditorActions(codeEditor), [codeEditor]);

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
        virtualFS.setQuickInputWidgetTop(true)
        codeEditor.focus();
        codeEditor.trigger("", "editor.action.quickCommand", "")
        const input = document.querySelector(".quick-input-box .input");
        input.value = "";
        input.dispatchEvent(new Event("input", {bubbles: true}))
    }

    useEffect(() => {
        const unsubscribe = virtualFS.notifications.subscribe("fileSelected", (file) => {
            if (file) {
                virtualFS.tabs.add(file);
                setEditorModelPath(file.id)
                codeEditor?.setModel(virtualFS.getModel(file.id))
                codeEditor?.restoreViewState(virtualFS.getModelState(file.id))
            }
            codeEditor?.focus()
        });
        const unsubscribeFileRemoved = virtualFS.notifications.subscribe("fileRemoved", (fileID) => {
            virtualFS.tabs.removeById(fileID)
            virtualFS.tabs.switchToLast()
            codeEditor?.focus()
        });
        const unsubscribeTabSwitched = virtualFS.notifications.subscribe("tabSwitched", (tabID) => {
            requestAnimationFrame(() => {
                setTimeout(() => {
                    setEditorModelPath(tabID)
                    virtualFS.setTreeObjectItemSelectedSilent(tabID)
                    codeEditor?.focus()
                }, 100)
            })
        });

        /*const handleBeforeUnload = (event) => {
            event.preventDefault()
            event.returnValue = ''
        };

        const handleElectronClose = () => {
            const userConfirmed = window.confirm('Changes will be discarded unless a snapshot is created!');
            if (userConfirmed) {
                window.electron.confirmEditorCloseApproved();
            }
        }
        const handleElectronReload = () => {
            const userConfirmed = window.confirm('Changes will be discarded unless a snapshot is created!');
            if (userConfirmed) {
                window.electron.confirmEditorReloadApproved();
            }
        };

        window.addEventListener('beforeunload', handleBeforeUnload)

        if (window.electron) {
            window.electron.onConfirmEditorClose(handleElectronClose)
            window.electron.onConfirmEditorReload(handleElectronReload);
        }*/

        return () => {
            //window.removeEventListener('beforeunload', handleBeforeUnload);
            unsubscribe()
            unsubscribeFileRemoved()
            unsubscribeTabSwitched()
        }
    }, []);

    return (
        <div className={styles["editor-page-component"]}>
            <div className={styles["editor-header"]}>
                <div className={styles["editor-header-left"]}>
                    <Button icon="arrow-left" variant={"minimal"}
                            disabled={virtualFS.tabs.get().length <= 1}
                            onClick={() => virtualFS.tabs.setActiveTabLeft()}
                            aria-label="arrow-left"/>
                    <Button icon="arrow-right" variant={"minimal"}
                            disabled={virtualFS.tabs.get().length <= 1}
                            onClick={() => virtualFS.tabs.setActiveTabRight()}
                            aria-label="arrow-right"/>
                </div>
                <div className={styles["editor-header-center"]}>
                    <InputGroup
                        leftIcon={"search"}
                        placeholder={virtualFS.getTreeObjectItemSelected()?.label}
                        round={true} fill={true} size={"small"}
                        inputClassName={styles["editor-header-search"]} onClick={() => openCodePaletteShow()}
                    />
                </div>
                <div className={styles["editor-header-right"]}></div>
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
                                minSize={200}
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
                                                <CodeDeployActions setSelectedTabId={setBuildOutputSelectedTabId}/>
                                            </div>
                                        </div>
                                    </div>
                                )}
                            />
                        </div>
                        <div className={styles["gutter-col"]} {...getGutterProps('column', 1)}></div>
                        <div className={styles["code-editor-build-output-terminal"]}>
                            <Split
                                minSize={200}
                                direction="column"
                                render={({
                                             getGridProps: getInnerCodeGridProps,
                                             getGutterProps: getInnerCodeGutterProps,
                                         }) => (
                                    <div {...getInnerCodeGridProps()} id={"code-editor"} className={styles["inner-editor-terminal-grid"]}>
                                        <div className={styles["code-editor"]}>
                                            <FileTabs closeTab={closeTab}/>
                                            <Editor height="100vh" defaultLanguage="plaintext"
                                                    onChange={handleEditorChange}
                                                    theme="vs-dark"
                                                    onValidate={(e) => {
                                                        if (e.length > 0) {
                                                            virtualFS.tabs.addMarkers(editorModelPath, e)
                                                        } else {
                                                            virtualFS.tabs.removeMarkers(editorModelPath)
                                                        }
                                                    }}
                                                    defaultValue={packageDefaultContent(rootFolder)}
                                                    path={editorModelPath}
                                                    className={styles["editor-container"]}
                                                    onMount={(editor) => {
                                                        setCodeEditor(editor)
                                                        monacoEditorStyle()
                                                    }}

                                                    options={{
                                                        minimap: {
                                                            enabled: true,
                                                            autohide: true,
                                                            size: "fill",
                                                            scale: 2
                                                        },
                                                        scrollbar: {vertical: "hidden", horizontal: "auto"},
                                                        fontSize: 13,
                                                        mouseWheelZoom: true,
                                                        smoothScrolling: true,
                                                        dragAndDrop: false,
                                                        automaticLayout: true,
                                                        fixedOverflowWidgets: false
                                                    }}
                                            />
                                        </div>
                                        <div className={styles["gutter-row-editor-terminal"]} {...getInnerCodeGutterProps('row', 1)}></div>
                                        <div className={styles["terminal-output-console"]}>
                                            <div className={styles["build-output-terminal"]}>
                                                <BuildOutputTerminalComponent selectedTabId={buildOutputSelectedTabId} setSelectedTabId={setBuildOutputSelectedTabId} />
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