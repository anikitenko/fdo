import {useLocation} from "react-router-dom";
import Split from "react-split-grid";
import * as monaco from 'monaco-editor';
import {Editor, loader} from '@monaco-editor/react';
import React from "react";

import * as styles from './EditorPage.module.css'
import {useEffect, useRef, useState} from "react";
import {Button, InputGroup, Spinner} from "@blueprintjs/core";
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
import {
    buildCapabilityAndDeprecationCodeActions,
    buildMetadataIconCodeActions,
    computeCapabilityAndDeprecationMarkers,
    mergeMonacoValidationMarkers,
    suggestBlueprintIcons,
} from "./utils/monacoCapabilityDiagnostics";

loader.config({monaco});

let editorOpenerRegistered = false;
let fdoCodeActionProvidersRegistered = false;
let activeCodeEditor = null;

function ensureFdoCodeActionProvidersRegistered() {
    if (fdoCodeActionProvidersRegistered) {
        return;
    }
    if (typeof monaco?.languages?.registerCodeActionProvider !== "function") {
        return;
    }

    const createProvider = () => ({
        provideCodeActions(model, _range, context) {
            const source = model?.getValue?.() || "";
            const markers = Array.isArray(context?.markers) ? context.markers : [];
            const actions = [];

            markers.forEach((marker) => {
                const fixes = [
                    ...buildMetadataIconCodeActions({source, marker}),
                    ...buildCapabilityAndDeprecationCodeActions({source, marker}),
                ];
                fixes.forEach((fix) => {
                    actions.push({
                        title: fix.title,
                        kind: "quickfix.fdo",
                        diagnostics: [marker],
                        edit: {
                            edits: [{
                                resource: model.uri,
                                textEdit: fix.edit,
                            }],
                        },
                        isPreferred: true,
                    });
                });
            });

            return {actions, dispose: () => {}};
        },
    });

    monaco.languages.registerCodeActionProvider("typescript", createProvider());
    monaco.languages.registerCodeActionProvider("javascript", createProvider());
    monaco.languages.registerCodeActionProvider("typescriptreact", createProvider());
    monaco.languages.registerCodeActionProvider("javascriptreact", createProvider());
    fdoCodeActionProvidersRegistered = true;
}

export const EditorPage = () => {
    const location = useLocation();
    // Extract data from the query parameter
    const searchParams = new URLSearchParams(location.search);
    const pluginData = JSON.parse(decodeURIComponent(searchParams.get("data") || "{}"));
    const pluginName = generatePluginName(pluginData.name)
    const pluginTemplate = pluginData.template
    const pluginDirectory = pluginData.dir
    const [editorModelPath, setEditorModelPath] = useState(virtualFS.getTreeObjectItemSelected()?.id)
    const [codeEditor, setCodeEditor] = useState(null)
    const [jumpTo, setJumpTo] = useState(null)
    const [buildOutputSelectedTabId, setBuildOutputSelectedTabId] = useState("problems")
    const [workspaceReady, setWorkspaceReady] = useState(false)
    const [workspaceError, setWorkspaceError] = useState("")
    const [hasOpenTabs, setHasOpenTabs] = useState(virtualFS.tabs.get().length > 0)
    const [restoreLoading, setRestoreLoading] = useState(virtualFS.fs.getRestoreLoading())
    const [restorePhase, setRestorePhase] = useState("idle")
    const [debugRenderStats, setDebugRenderStats] = useState({ shell: 0, tabs: 0, tree: 0, lastComponent: "", lastTs: 0 })
    const [grantedCapabilities, setGrantedCapabilities] = useState([]);
    const [pluginPersisted, setPluginPersisted] = useState(false);
    const diagnosticsListenerDisposeRef = useRef(null);
    const initialSnapshotCreatedRef = useRef(false)
    // Request deduplication flags for window close/reload
    const [closeInProgress, setCloseInProgress] = useState(false)
    const [reloadInProgress, setReloadInProgress] = useState(false)
    const closeInProgressRef = useRef(false)
    const reloadInProgressRef = useRef(false)
    const suppressBeforeUnloadPromptRef = useRef(false)
    const pendingTabSwitchFrameRef = useRef(null)
    const closeTab = (fileID) => {
        if (virtualFS.getModel(fileID))
            virtualFS.updateModelState(fileID, codeEditor.saveViewState())
        virtualFS.tabs.removeById(fileID)
    }

    useEffect(() => {
        document.title = "Plugin Editor";
        return () => {
            activeCodeEditor = null;
        };
    }, []);

    useEffect(() => {
        let cancelled = false;

        const initializeWorkspace = async () => {
            try {
                virtualFS.resetWorkspaceState();
                initialSnapshotCreatedRef.current = false;
                setWorkspaceReady(false);
                setWorkspaceError("");
                await setupVirtualWorkspace(pluginName, pluginData.name.trim(), pluginTemplate, pluginDirectory);
                if (cancelled) return;

                if (!editorOpenerRegistered) {
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
                    editorOpenerRegistered = true;
                }

                const activeTabId = virtualFS.tabs.getActiveTabId();
                const initialFile =
                    virtualFS.getTreeObjectItemSelected() ||
                    virtualFS.getTreeObjectItemById(activeTabId) ||
                    virtualFS.getTreeObjectItemById(virtualFS.DEFAULT_FILE_MAIN);

                if (initialFile) {
                    virtualFS.setTreeObjectItemSelectedSilent(initialFile.id);

                    if (virtualFS.tabs.get().length === 0) {
                        virtualFS.tabs.add(initialFile);
                    } else if (!activeTabId) {
                        virtualFS.tabs.setActiveTab(initialFile);
                    }
                }

                setEditorModelPath(initialFile?.id || virtualFS.DEFAULT_FILE_MAIN);
                setHasOpenTabs(virtualFS.tabs.get().length > 0);
                setWorkspaceReady(true);
            } catch (error) {
                if (!cancelled) {
                    setWorkspaceError(error?.message || "Failed to initialize editor workspace");
                }
            }
        };

        initializeWorkspace();
        return () => {
            cancelled = true;
        };
    }, [pluginDirectory, pluginName, pluginTemplate, pluginData.name]);

    useEffect(() => codeEditorActions(codeEditor), [codeEditor]);

    useEffect(() => {
        ensureFdoCodeActionProvidersRegistered();
    }, []);

    const getBaseMonacoMarkersForModel = (model) => {
        if (!model?.uri) {
            return [];
        }
        return monaco.editor
            .getModelMarkers({resource: model.uri})
            .filter((marker) => {
                if (String(marker?.source || "").toLowerCase() === "fdo-capability") {
                    return false;
                }
                const markerCode = String(marker?.code || "");
                return !markerCode.startsWith("FDO_");
            });
    };

    const applyFdoCapabilityDiagnostics = (modelPath, baseMarkers = null) => {
        if (!modelPath) return;
        const model = virtualFS.getModel(modelPath);
        if (!model) return;

        const source = model?.getValue?.() || "";
        const capabilityMarkers = computeCapabilityAndDeprecationMarkers({
            source,
            grantedCapabilities,
            pluginPersisted,
        });

        monaco.editor.setModelMarkers(model, "fdo-capability", capabilityMarkers);
        const mergedMarkers = mergeMonacoValidationMarkers(
            Array.isArray(baseMarkers) ? baseMarkers : getBaseMonacoMarkersForModel(model),
            capabilityMarkers
        );

        if (mergedMarkers.length > 0) {
            virtualFS.tabs.addMarkers(modelPath, mergedMarkers);
        } else {
            virtualFS.tabs.removeMarkers(modelPath);
        }
    };

    useEffect(() => {
        let cancelled = false;
        const pluginId = pluginData?.name?.trim?.();
        if (!pluginId || !window?.electron?.plugin?.get) {
            setGrantedCapabilities([]);
            setPluginPersisted(false);
            return () => {
                cancelled = true;
            };
        }

        window.electron.plugin.get(pluginId).then((result) => {
            if (cancelled) {
                return;
            }
            setPluginPersisted(!!result?.plugin?.id);
            const caps = Array.isArray(result?.plugin?.capabilities) ? result.plugin.capabilities : [];
            setGrantedCapabilities(caps);
        }).catch(() => {
            if (!cancelled) {
                setGrantedCapabilities([]);
                setPluginPersisted(false);
            }
        });

        return () => {
            cancelled = true;
        };
    }, [pluginData?.name]);

    useEffect(() => {
        if (typeof window === "undefined" || !window.__E2E__) {
            return;
        }

        const collectTreeIds = (nodes = []) => {
            const ids = [];
            for (const node of nodes) {
                ids.push(node.id);
                if (node.childNodes?.length) {
                    ids.push(...collectTreeIds(node.childNodes));
                }
            }
            return ids;
        };

        const isWorkspaceTreeId = (id) => (
            typeof id === "string" &&
            !id.startsWith("/node_modules") &&
            !id.startsWith("/dist")
        );

        const getState = () => {
            const treeIds = collectTreeIds(virtualFS.getTreeObjectSortedAsc());
            return {
            treeIds,
            workspaceTreeIds: treeIds.filter(isWorkspaceTreeId),
            filesKeys: Object.keys(virtualFS.files || {}),
            tabs: virtualFS.tabs.get().map((tab) => ({ id: tab.id, active: !!tab.active })),
            activeTabId: virtualFS.tabs.getActiveTabId(),
            selectedId: virtualFS.getTreeObjectItemSelected()?.id || null,
            currentVersion: virtualFS.fs.version().version,
            versions: virtualFS.fs.list().map((version) => ({
                version: version.version,
                current: !!version.current,
                prev: version.prev,
            })),
            restoreLoading: virtualFS.fs.getRestoreLoading(),
            nodeModulesLoading: virtualFS.fs.getNodeModulesLoading(),
            initWorkspace: virtualFS.isInitWorkspace(),
            sandboxName: virtualFS.sandboxName,
            markers: virtualFS.tabs.listMarkers(),
        };
        };

        window.__editorTestApi = {
            getState,
            createFile(filePath, content, language = "typescript") {
                const uri = monaco.Uri.file(filePath);
                let model = monaco.editor.getModel(uri);
                if (!model) {
                    model = monaco.editor.createModel(content, language, uri);
                } else {
                    model.setValue(content);
                }
                virtualFS.createFile(filePath, model, { suppressDefaultSelection: true });
                return getState();
            },
            getModelMarkers(filePath = "/index.ts") {
                const uri = monaco.Uri.file(filePath);
                const model = monaco.editor.getModel(uri);
                if (!model) {
                    return [];
                }
                return monaco.editor.getModelMarkers({resource: model.uri}).map((marker) => ({
                    message: marker?.message || "",
                    source: marker?.source || "",
                    code: marker?.code || "",
                    startLineNumber: marker?.startLineNumber || 0,
                    endLineNumber: marker?.endLineNumber || 0,
                    startColumn: marker?.startColumn || 0,
                    endColumn: marker?.endColumn || 0,
                }));
            },
            getFileContent(filePath = "/index.ts") {
                const uri = monaco.Uri.file(filePath);
                const model = monaco.editor.getModel(uri);
                if (!model) {
                    return null;
                }
                return model.getValue?.() ?? null;
            },
            suggestBlueprintIcons(input = "", limit = 5) {
                return suggestBlueprintIcons(input, limit);
            },
            getMetadataIconQuickFixTitles(iconValue = "zzbzfbfb") {
                const source = `
                    private readonly _metadata: PluginMetadata = {
                        name: "Example",
                        version: "1.0.0",
                        author: "Test",
                        description: "Demo",
                        icon: "${String(iconValue || "")}",
                    };
                `;
                const markers = computeCapabilityAndDeprecationMarkers({
                    source,
                    grantedCapabilities: [],
                });
                const invalidMarker = markers.find((marker) => marker.code === "FDO_INVALID_METADATA_ICON");
                if (!invalidMarker) {
                    return [];
                }
                return buildMetadataIconCodeActions({source, marker: invalidMarker}).map((fix) => fix.title);
            },
            getMetadataIconQuickFixTitlesForPath(filePath = "/index.ts") {
                const uri = monaco.Uri.file(filePath);
                const model = monaco.editor.getModel(uri);
                if (!model) {
                    return [];
                }
                const source = model.getValue?.() || "";
                const markers = computeCapabilityAndDeprecationMarkers({
                    source,
                    grantedCapabilities,
                    pluginPersisted,
                });
                const invalidMarker = markers.find((marker) => marker.code === "FDO_INVALID_METADATA_ICON");
                if (!invalidMarker) {
                    return [];
                }
                return buildMetadataIconCodeActions({source, marker: invalidMarker}).map((fix) => fix.title);
            },
            focusEditor() {
                activeCodeEditor?.focus?.();
                return !!activeCodeEditor;
            },
            setEditorPosition(lineNumber = 1, column = 1) {
                if (!activeCodeEditor?.setPosition) {
                    return false;
                }
                activeCodeEditor.setPosition({lineNumber, column});
                activeCodeEditor.revealPositionInCenter?.({lineNumber, column});
                activeCodeEditor.focus?.();
                return true;
            },
            async triggerQuickFix() {
                if (!activeCodeEditor) {
                    return false;
                }
                if (typeof activeCodeEditor.trigger === "function") {
                    activeCodeEditor.trigger("keyboard", "editor.action.quickFix", {});
                    return true;
                }
                if (typeof activeCodeEditor.getAction === "function") {
                    const action = activeCodeEditor.getAction("editor.action.quickFix");
                    if (action?.run) {
                        await action.run();
                        return true;
                    }
                }
                return false;
            },
            applyFirstMetadataIconQuickFixForPath(filePath = "/index.ts") {
                const uri = monaco.Uri.file(filePath);
                const model = monaco.editor.getModel(uri);
                if (!model) {
                    return false;
                }
                const source = model.getValue?.() || "";
                const markers = computeCapabilityAndDeprecationMarkers({
                    source,
                    grantedCapabilities,
                    pluginPersisted,
                });
                const invalidMarker = markers.find((marker) => marker.code === "FDO_INVALID_METADATA_ICON");
                if (!invalidMarker) {
                    return false;
                }
                const fixes = buildMetadataIconCodeActions({source, marker: invalidMarker});
                const firstFix = fixes[0];
                if (!firstFix?.edit?.range || typeof firstFix.edit.text !== "string") {
                    return false;
                }
                model.applyEdits([{
                    range: firstFix.edit.range,
                    text: firstFix.edit.text,
                    forceMoveMarkers: true,
                }]);
                return true;
            },
            deleteFile(filePath) {
                virtualFS.deleteFile(filePath);
                return getState();
            },
            openTabs(savedTabs = []) {
                virtualFS.tabs.replaceFromSaved(savedTabs);
                return getState();
            },
            createSnapshot() {
                const currentVersion = virtualFS.fs.version();
                const tabs = virtualFS.tabs.get()
                    .filter((tab) => tab.id !== "Untitled")
                    .map((tab) => ({ id: tab.id, active: !!tab.active }));
                return virtualFS.fs.create(currentVersion.version, tabs, { quiet: true });
            },
            async switchSnapshot(versionId) {
                const data = virtualFS.fs.set(versionId);
                virtualFS.tabs.replaceFromSaved(data?.tabs || []);
                if (data?.nodeModulesPromise?.then) {
                    await data.nodeModulesPromise;
                }
                return getState();
            },
        };

        return () => {
            try {
                delete window.__editorTestApi;
            } catch (_) {}
        };
    }, []);

    useEffect(() => {
        const unsubscribeRestoreLoading = virtualFS.notifications.subscribe("restoreLoading", setRestoreLoading);
        const unsubscribeRestorePhase = virtualFS.notifications.subscribe("restorePhase", setRestorePhase);
        setRestoreLoading(virtualFS.fs.getRestoreLoading());
        return () => {
            unsubscribeRestoreLoading();
            unsubscribeRestorePhase();
        };
    }, []);

    useEffect(() => {
        if (!restoreLoading) return;
        let cancelled = false;
        const sync = () => {
            if (cancelled) return;
            if (!virtualFS.fs.getRestoreLoading()) {
                setRestoreLoading(false);
                setRestorePhase("idle");
                return;
            }
            requestAnimationFrame(sync);
        };
        requestAnimationFrame(sync);
        return () => {
            cancelled = true;
        };
    }, [restoreLoading]);

    useEffect(() => {
        if (typeof window === "undefined") return;
        const debugEnabled = window.localStorage?.getItem("editor.restoreDebug") === "true";
        if (!debugEnabled) return;

        const handleRenderDebug = (event) => {
            const component = event?.detail?.component;
            if (!component) return;
            setDebugRenderStats((prev) => ({
                shell: prev.shell,
                tabs: component === "tabs" ? prev.tabs + 1 : prev.tabs,
                tree: component === "tree" ? prev.tree + 1 : prev.tree,
                lastComponent: component,
                lastTs: Date.now()
            }));
        };

        window.addEventListener("editor-render-debug", handleRenderDebug);
        return () => {
            window.removeEventListener("editor-render-debug", handleRenderDebug);
        };
    }, []);

    useEffect(() => {
        if (!restoreLoading) return;
        const debugEnabled = typeof window !== "undefined" && window.localStorage?.getItem("editor.restoreDebug") === "true";
        if (!debugEnabled) return;
        setDebugRenderStats((prev) => ({
            shell: prev.shell + 1,
            tabs: prev.tabs,
            tree: prev.tree,
            lastComponent: "shell",
            lastTs: Date.now()
        }));
    });

    useEffect(() => {
        if (!workspaceReady || workspaceError || initialSnapshotCreatedRef.current) {
            return;
        }

        if (virtualFS.fs.list().length > 0) {
            initialSnapshotCreatedRef.current = true;
            return;
        }

        const initialTabs = virtualFS.tabs.get()
            .filter((tab) => tab.id !== "Untitled")
            .map((tab) => ({
                id: tab.id,
                active: tab.active
            }));

        virtualFS.fs.create("", initialTabs, { quiet: true });
        initialSnapshotCreatedRef.current = true;
    }, [workspaceReady, workspaceError]);

    useEffect(() => {
        if (!editorModelPath) {
            return;
        }
        applyFdoCapabilityDiagnostics(editorModelPath);
    }, [editorModelPath, grantedCapabilities, pluginPersisted]);

    useEffect(() => {
        if (!codeEditor || !editorModelPath) {
            return;
        }

        diagnosticsListenerDisposeRef.current?.dispose?.();
        const model = virtualFS.getModel(editorModelPath);
        if (!model?.onDidChangeContent) {
            return;
        }
        diagnosticsListenerDisposeRef.current = model.onDidChangeContent(() => {
            applyFdoCapabilityDiagnostics(editorModelPath);
        });

        return () => {
            diagnosticsListenerDisposeRef.current?.dispose?.();
            diagnosticsListenerDisposeRef.current = null;
        };
    }, [codeEditor, editorModelPath, grantedCapabilities, pluginPersisted]);

    useEffect(() => {
        if (!codeEditor || !workspaceReady || !editorModelPath) return;
        const model = virtualFS.getModel(editorModelPath);
        if (!model) return;
        try {
            codeEditor.setModel(model);
            const state = virtualFS.getModelState(editorModelPath);
            if (state) {
                codeEditor.restoreViewState(state);
            }
        } catch (error) {
            console.error("[EditorPage] Failed to bind Monaco model to editor", error);
            setCodeEditor(null);
        }
    }, [codeEditor, editorModelPath, workspaceReady]);

    useEffect(() => {
        if (!hasOpenTabs) {
            setCodeEditor(null);
        }
    }, [hasOpenTabs]);

    useEffect(() => {
        closeInProgressRef.current = closeInProgress;
    }, [closeInProgress]);

    useEffect(() => {
        reloadInProgressRef.current = reloadInProgress;
    }, [reloadInProgress]);

    useEffect(() => {
        if (jumpTo) {
            if (jumpTo.id && codeEditor) {
                if (!virtualFS.getModel(jumpTo.id)) return
                virtualFS.setTreeObjectItemBool(jumpTo.id, "isSelected")
                setTimeout(() => {
                    codeEditor.setSelection(jumpTo.options.selection);
                    codeEditor.revealLine(jumpTo.options.selection.startLineNumber)
                }, 200)
            }
        }
    }, [codeEditor, jumpTo]);

    const openCodePaletteShow = () => {
        if (!codeEditor) return;
        codeEditor.focus();
        codeEditor.trigger("", "editor.action.quickCommand", "")
        requestAnimationFrame(() => {
            const input = document.querySelector(".quick-input-box .input");
            if (!input) return;
            input.value = "";
            input.dispatchEvent(new Event("input", {bubbles: true}))
        });
    }

    const getReopenTargetFile = () => {
        const workspaceFileIds = (() => {
            try {
                return Object.keys(virtualFS.getLatestContent?.() || {}).filter((path) => (
                    typeof path === "string"
                    && path.startsWith("/")
                    && !path.startsWith("/node_modules/")
                    && !path.startsWith("/dist/")
                ));
            } catch (_) {
                return [];
            }
        })();
        const firstWorkspaceFile = workspaceFileIds
            .map((path) => virtualFS.getTreeObjectItemById(path))
            .find((item) => item?.type === "file");

        return (
            virtualFS.getTreeObjectItemById(virtualFS.DEFAULT_FILE_MAIN)
            || virtualFS.getTreeObjectItemById(virtualFS.DEFAULT_FILE_RENDER)
            || firstWorkspaceFile
            || null
        );
    };

    const reopenPreferredFile = () => {
        const preferredFile = getReopenTargetFile();

        if (!preferredFile?.id) return;

        virtualFS.setTreeObjectItemSelectedSilent(preferredFile.id);
        virtualFS.tabs.add(preferredFile);
        setHasOpenTabs(true);
        setEditorModelPath(preferredFile.id);
    };

    const reopenTargetFile = getReopenTargetFile();
    const reopenButtonText = reopenTargetFile?.id === virtualFS.DEFAULT_FILE_MAIN
        ? "Open Main File"
        : "Open Available File";

    useEffect(() => {
        const unsubscribe = virtualFS.notifications.subscribe("fileSelected", (file) => {
            if (file) {
                virtualFS.tabs.add(file);
                setHasOpenTabs(true);
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
        const unsubscribeFileTabs = virtualFS.notifications.subscribe("fileTabs", (tabs = []) => {
            const nextHasOpenTabs = (tabs || []).length > 0;
            setHasOpenTabs(nextHasOpenTabs);
            if (!nextHasOpenTabs) {
                setEditorModelPath(null);
            }
        });
        const unsubscribeTabSwitched = virtualFS.notifications.subscribe("tabSwitched", (tabID) => {
            if (pendingTabSwitchFrameRef.current) {
                cancelAnimationFrame(pendingTabSwitchFrameRef.current);
            }
            pendingTabSwitchFrameRef.current = requestAnimationFrame(() => {
                pendingTabSwitchFrameRef.current = null;
                if (!tabID) {
                    setEditorModelPath(null);
                    return;
                }
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
            })
        });

        const isTestEnv = (typeof process !== 'undefined' && process.env && process.env.NODE_ENV === 'test') || (typeof window !== 'undefined' && window.__TEST__);

        const handleBeforeUnload = (event) => {
            if (suppressBeforeUnloadPromptRef.current) {
                return;
            }
            event.preventDefault()
            event.returnValue = ''
        };

        const handleElectronClose = () => {
            // Prevent duplicate close requests
            if (closeInProgressRef.current) {
                console.log('[Editor Close] Close already in progress, ignoring duplicate request');
                return;
            }
            closeInProgressRef.current = true;
            setCloseInProgress(true);
            const userConfirmed = window.confirm('Changes will be discarded unless a snapshot is created!');
            
            if (userConfirmed) {
                suppressBeforeUnloadPromptRef.current = true;
                window.electron.system.confirmEditorCloseApproved?.();
                // Component will unmount after close, no need to reset flag
            } else {
                // User cancelled, allow retry
                closeInProgressRef.current = false;
                setCloseInProgress(false);
            }
        }
        const handleElectronReload = () => {
            // Prevent duplicate reload requests
            if (reloadInProgressRef.current) {
                console.log('[Editor Reload] Reload already in progress, ignoring duplicate request');
                return;
            }
            reloadInProgressRef.current = true;
            setReloadInProgress(true);
            const userConfirmed = window.confirm('Changes will be discarded unless a snapshot is created!');
            
            if (userConfirmed) {
                suppressBeforeUnloadPromptRef.current = true;
                window.electron.system.confirmEditorReloadApproved?.();
                // Window will reload, no need to reset flag
            } else {
                // User cancelled, allow retry
                reloadInProgressRef.current = false;
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
                window.electron?.system?.off?.confirmEditorClose?.(handleElectronClose);
                window.electron?.system?.off?.confirmEditorReload?.(handleElectronReload);
            }
            unsubscribe()
            unsubscribeFileRemoved()
            unsubscribeFileTabs()
            unsubscribeTabSwitched()
            if (pendingTabSwitchFrameRef.current) {
                cancelAnimationFrame(pendingTabSwitchFrameRef.current);
                pendingTabSwitchFrameRef.current = null;
            }
        }
    }, [codeEditor]);

    // Compact mode state & handlers
    const [compact] = useState(() => {
        try {
            return localStorage.getItem('ui.compact.enabled') === 'true';
        } catch (_) {
            return true;
        }
    });
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
            {!workspaceReady && !workspaceError && (
                <div className={styles["editorLoadingState"]}>
                    <div className={styles["editorLoadingCard"]}>
                        <div className={styles["editorLoadingTitle"]}>Preparing editor workspace…</div>
                        <div className={styles["editorLoadingSubtitle"]}>Loading project files, types, and editor services.</div>
                    </div>
                </div>
            )}
            {workspaceError && (
                <div className={styles["editorLoadingState"]}>
                    <div className={styles["editorLoadingCard"]}>
                        <div className={styles["editorLoadingTitle"]}>Editor failed to initialize</div>
                        <div className={styles["editorLoadingSubtitle"]}>{workspaceError}</div>
                    </div>
                </div>
            )}
            {workspaceReady && (
            <div className={styles["editorWorkspaceShell"]}>
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
                                            <CodeDeployActions
                                                setSelectedTabId={setBuildOutputSelectedTabId}
                                                currentSelectedTabId={buildOutputSelectedTabId}
                                                pluginDirectory={pluginDirectory}
                                            />
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
                                        {hasOpenTabs && editorModelPath ? (
                                            <Editor defaultLanguage="plaintext"
                                                    theme="editor-dark"
                                                    height={"calc(100% - 69px)"}
                                                    onValidate={(e) => {
                                                        if (!editorModelPath) return;
                                                        applyFdoCapabilityDiagnostics(editorModelPath, e);
                                                    }}
                                                    defaultValue={packageDefaultContent(pluginName)}
                                                    path={editorModelPath}
                                                    className={styles["editor-container"]}
                                                    onMount={(editor) => {
                                                        setCodeEditor(editor)
                                                        activeCodeEditor = editor
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
                                        ) : (
                                            <div className={styles["editorEmptyState"]} role="status" aria-live="polite">
                                                <div className={styles["editorEmptyCard"]}>
                                                    <div className={styles["editorEmptyTitle"]}>No file open</div>
                                                    <div className={styles["editorEmptySubtitle"]}>
                                                        Select a file from Project Explorer or reopen the main plugin file.
                                                    </div>
                                                    <Button
                                                        small
                                                        icon="document-open"
                                                        text={reopenButtonText}
                                                        onClick={reopenPreferredFile}
                                                        disabled={!reopenTargetFile}
                                                    />
                                                </div>
                                            </div>
                                        )}
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
            {restoreLoading && (
                <div className={styles["editorRestoreOverlay"]} role="alertdialog" aria-live="assertive" aria-busy="true" aria-label="Restoring snapshot">
                    <div className={styles["editorRestoreCard"]}>
                        <Spinner size={22} />
                        <div className={styles["editorRestoreTitle"]}>Restoring snapshot…</div>
                        <div className={styles["editorRestoreSubtitle"]}>Updating files, tabs, and editor state. Interaction is temporarily paused.</div>
                    </div>
                </div>
            )}
            {typeof window !== "undefined" && window.localStorage?.getItem("editor.restoreDebug") === "true" && (
                <div className={styles["editorRestoreDebugHud"]} role="status" aria-live="polite">
                    <div className={styles["editorRestoreDebugTitle"]}>Restore Debug</div>
                    <div>phase: <strong>{restorePhase}</strong></div>
                    <div>shell renders: {debugRenderStats.shell}</div>
                    <div>tabs renders: {debugRenderStats.tabs}</div>
                    <div>tree renders: {debugRenderStats.tree}</div>
                    <div>last render: {debugRenderStats.lastComponent || "n/a"}</div>
                </div>
            )}
            </div>
            )}
            <FileDialogComponent/>
        </div>
    );
}
