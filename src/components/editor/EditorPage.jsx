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
import SnapshotToolbarMount from "./snapshots/SnapshotMount.jsx";
import SidebarSection from "../common/SidebarSection.jsx";
import codeEditorActions from "./utils/codeEditorActions";
import EditorStyle from "./monaco/EditorStyle";
import BuildOutputTerminalComponent from "./BuildOutputTerminalComponent";
import generatePluginName from "./utils/generatePluginName";
import {ShowLightbulbIconMode} from "monaco-editor/esm/vs/editor/common/config/editorOptions";

export const EditorPage = () => {
    document.title = "Plugin Editor";
    loader.config({monaco});

    const location = useLocation();
    // Extract data from the query parameter
    const searchParams = new URLSearchParams(location.search);
    const pluginData = JSON.parse(decodeURIComponent(searchParams.get("data") || "{}"));
    const pluginName = generatePluginName(pluginData.name)
    const pluginTemplate = pluginData.template
    const pluginDirectory = pluginData.dir
    const [editorModelPath, setEditorModelPath] = useState(virtualFS.getTreeObjectItemSelected()?.id)
    const [codeEditorCreated, setCodeEditorCreated] = useState(false)
    const [codeEditor, setCodeEditor] = useState(null)
    const [jumpTo, setJumpTo] = useState(null)
    const [buildOutputSelectedTabId, setBuildOutputSelectedTabId] = useState("problems")
    // Request deduplication flags for window close/reload
    const [closeInProgress, setCloseInProgress] = useState(false)
    const [reloadInProgress, setReloadInProgress] = useState(false)
    const closeTab = (fileID) => {
        if (virtualFS.getModel(fileID))
            virtualFS.updateModelState(fileID, codeEditor.saveViewState())
        virtualFS.tabs.removeById(fileID)
    }

    monaco.editor.onDidCreateEditor(async () => {
        if (!codeEditorCreated) {
            await setupVirtualWorkspace(pluginName, pluginData.name.trim(), pluginTemplate, pluginDirectory)
            monaco.editor.registerEditorOpener({
                openCodeEditor(source, resource, selectionOrPosition) {
                    setJumpTo({
                        id: resource.toString(true).replace("file://", ""),
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
            setTimeout(() => {
                setEditorModelPath(tabID)
                virtualFS.setTreeObjectItemSelectedSilent(tabID)
                // Ensure the editor model is switched and its view state (cursor/scroll/selection) is restored
                const model = virtualFS.getModel(tabID);
                if (model) {
                    codeEditor?.setModel(model);
                    const state = virtualFS.getModelState(tabID);
                    if (state) codeEditor?.restoreViewState(state);
                }
                codeEditor?.focus()
            }, 100)
        });

        const isTestEnv = (typeof process !== 'undefined' && process.env && process.env.NODE_ENV === 'test') || (typeof window !== 'undefined' && window.__TEST__);

        const handleBeforeUnload = (event) => {
            event.preventDefault()
            event.returnValue = ''
        };

        const handleElectronClose = () => {
            // Prevent duplicate close requests
            if (closeInProgress) {
                console.log('[Editor Close] Close already in progress, ignoring duplicate request');
                return;
            }
            
            setCloseInProgress(true);
            const userConfirmed = window.confirm('Changes will be discarded unless a snapshot is created!');
            
            if (userConfirmed) {
                window.electron.system.confirmEditorCloseApproved?.();
                // Component will unmount after close, no need to reset flag
            } else {
                // User cancelled, allow retry
                setCloseInProgress(false);
            }
        }
        const handleElectronReload = () => {
            // Prevent duplicate reload requests
            if (reloadInProgress) {
                console.log('[Editor Reload] Reload already in progress, ignoring duplicate request');
                return;
            }
            
            setReloadInProgress(true);
            const userConfirmed = window.confirm('Changes will be discarded unless a snapshot is created!');
            
            if (userConfirmed) {
                window.electron.system.confirmEditorReloadApproved?.();
                // Window will reload, no need to reset flag
            } else {
                // User cancelled, allow retry
                setReloadInProgress(false);
            }
        };

        // Skip blocking handlers in tests/E2E to avoid hangs
        if (!isTestEnv) {
            window.addEventListener('beforeunload', handleBeforeUnload)
            window.electron?.system?.on?.confirmEditorClose?.(handleElectronClose);
            window.electron?.system?.on?.confirmEditorReload?.(handleElectronReload);
        }

        return () => {
            if (!isTestEnv) {
                window.removeEventListener('beforeunload', handleBeforeUnload);
            }
            unsubscribe()
            unsubscribeFileRemoved()
            unsubscribeTabSwitched()
        }
    }, []);

    // Compact mode state & handlers
    const [compact, setCompact] = useState(true);
    useEffect(() => {
        try {
            const raw = localStorage.getItem('ui.compact.enabled');
            setCompact(raw === 'true');
        } catch (_) {}
    }, []);
    /*const toggleCompact = () => {
        const next = !compact;
        setCompact(next);
        try { localStorage.setItem('ui.compact.enabled', next ? 'true' : 'false'); } catch (_) {}
        try { window.dispatchEvent(new Event('ui:compact-changed')); } catch (_) {}
    };*/

    return (
        <div className={`${styles["editor-page-component"]} ${compact ? styles["compact"] : ""}`}>
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
                        placeholder={`\u{1F50D} ${virtualFS.getTreeObjectItemSelected()?.label}`}
                        round={true} fill={true} size={"small"} className={styles["editor-header-search-wrapper"]}
                        inputClassName={styles["editor-header-search"]} onClick={() => openCodePaletteShow()}
                    />
                </div>
                <div className={styles["editor-header-right"]}>
                    {/* Snapshot Toolbar (always on) */}
                    <SnapshotToolbarMount />
                </div>
            </div>
            <Split
                columnMinSize={50}
                onDrag={() => {
                    codeEditor?.layout();
                }}
                render={({
                             getGridProps,
                             getGutterProps,
                         }) => (
                    <div className={`bp6-dark ${styles["grid-container"]}`} {...getGridProps()}>
                        <Split
                            rowMinSize={50}
                            direction="column"
                            render={({
                                         getGridProps: getInnerGridProps,
                                         getGutterProps: getInnerGutterProps,
                                     }) => (
                                <div {...getInnerGridProps()} className={styles["inner-files-deploy-grid"]}>
                                    <div className={styles["file-browser-tree"]}>
                                        <SidebarSection id="project-explorer" title="Project Explorer" defaultCollapsed={false}>
                                            <FileBrowserComponent/>
                                        </SidebarSection>
                                    </div>
                                    <div className={styles["gutter-row"]} {...getInnerGutterProps('row', 1)}></div>
                                    <div>
                                        <div className={styles["code-deploy-actions"]}>
                                            <CodeDeployActions setSelectedTabId={setBuildOutputSelectedTabId} pluginDirectory={pluginDirectory}/>
                                        </div>
                                    </div>
                                </div>
                            )}
                        />
                        <div className={styles["gutter-col"]} {...getGutterProps('column', 1)}></div>
                        <Split
                            rowMinSize={100}
                            onDrag={() => {
                                codeEditor?.layout();
                            }}
                            direction="column"
                            render={({
                                         getGridProps: getInnerCodeGridProps,
                                         getGutterProps: getInnerCodeGutterProps,
                                     }) => (
                                <div {...getInnerCodeGridProps()} id={"code-editor"}
                                     className={styles["inner-editor-terminal-grid"]}>
                                    <div style={{minWidth: "0", overflow: "hidden", width: "100%"}}>
                                        <FileTabs closeTab={closeTab}/>
                                        <Editor defaultLanguage="plaintext"
                                                theme="editor-dark"
                                                height={"calc(100% - 69px)"}
                                                onValidate={(e) => {
                                                    if (e.length > 0) {
                                                        virtualFS.tabs.addMarkers(editorModelPath, e)
                                                    } else {
                                                        virtualFS.tabs.removeMarkers(editorModelPath)
                                                    }
                                                }}
                                                defaultValue={packageDefaultContent(pluginName)}
                                                path={editorModelPath}
                                                className={styles["editor-container"]}
                                                onMount={(editor) => {
                                                    setCodeEditor(editor)
                                                    EditorStyle()
                                                }}

                                                options={{
                                                    minimap: {
                                                        enabled: true,
                                                        autohide: true,
                                                        size: "fill",
                                                        scale: 1.5
                                                    },
                                                    linkedEditing: true,
                                                    lightbulb: {
                                                        enabled: ShowLightbulbIconMode.On
                                                    },
                                                    scrollbar: {vertical: "auto", horizontal: "auto"},
                                                    stickyScroll: {
                                                        enabled: true,
                                                        maxLineCount: 5,
                                                    },
                                                    fontSize: 13,
                                                    mouseWheelZoom: true,
                                                    smoothScrolling: true,
                                                    dragAndDrop: false,
                                                    automaticLayout: true,
                                                    fixedOverflowWidgets: true,
                                                    scrollBeyondLastLine: false,
                                                }}
                                        />
                                    </div>
                                    <div
                                        className={styles["gutter-row-editor-terminal"]} {...getInnerCodeGutterProps('row', 1)}></div>
                                    <div className={styles["terminal-output-console"]}>
                                        <div className={styles["build-output-terminal"]}>
                                            <BuildOutputTerminalComponent 
                                                selectedTabId={buildOutputSelectedTabId}
                                                setSelectedTabId={setBuildOutputSelectedTabId}
                                                codeEditor={codeEditor}
                                                editorModelPath={editorModelPath}
                                            />
                                        </div>
                                    </div>
                                </div>
                            )}
                        />
                    </div>
                )}
            />
            <FileDialogComponent/>
        </div>
    );
}