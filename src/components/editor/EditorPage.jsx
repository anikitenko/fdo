import {useLocation} from "react-router-dom";
import PropTypes from 'prop-types';
import Split from "react-split-grid";
import * as monaco from 'monaco-editor';
import {Editor, loader} from '@monaco-editor/react';

import './EditorPage.css'
import {useEffect, useState} from "react";
import {Button, Card, InputGroup} from "@blueprintjs/core";
import {FDO_SDK} from "@anikitenko/fdo-sdk";
import {setupVirtualWorkspace} from "./utils/setupVirtualWorkspace";
import virtualFS from "./utils/VirtualFS";
import {packageDefaultContent} from "./utils/packageDefaultContent";
import FileBrowserComponent from "./FileBrowserComponent";
import FileTabComponent from "./FileTabComponent";

const FileTabs = ({openTabs, activeTab, setActiveTab, closeTab, codeEditor}) => (
    <div className={"file-tabs"}>
        {openTabs.map((file) => (
            <FileTabComponent key={file.id} file={file} activeTab={activeTab} setActiveTab={setActiveTab} closeTab={closeTab} codeEditor={codeEditor} />
        ))}
    </div>
);
FileTabs.propTypes = {
    openTabs: PropTypes.array.isRequired,
    activeTab: PropTypes.any,
    setActiveTab: PropTypes.func.isRequired,
    closeTab: PropTypes.func.isRequired,
    codeEditor: PropTypes.any
}

export const EditorPage = () => {
    document.title = "Plugin Editor";
    loader.config({monaco});

    const location = useLocation();
    // Extract data from the query parameter
    const searchParams = new URLSearchParams(location.search);
    const pluginData = JSON.parse(decodeURIComponent(searchParams.get("data") || "{}"));
    const rootFolder = FDO_SDK.generatePluginName(pluginData.name)
    const pluginTemplate = pluginData.template


    const [codeEditor, setCodeEditor] = useState(null)
    const [selectedFile, setSelectedFile] = useState(virtualFS.getTreeObjectItemSelected())
    const [openTabs, setOpenTabs] = useState([])
    const [activeTab, setActiveTab] = useState(null)
    const [jumpTo, setJumpTo] = useState(null)
    const addTab = (file) => {
        if (!openTabs.some((tab) => tab.id === file.id)) {
            setOpenTabs((prevTabs) => [...prevTabs, file])
        }
        setActiveTab(file)
    };
    const closeTab = (file) => {
        setOpenTabs((prevTabs) => prevTabs.filter((tab) => tab.id !== file.id))

        // If closing the active file, switch to the first open tab
        if (activeTab.id === file.id) {
            const remainingTabs = openTabs.filter((tab) => tab.id !== file.id)
            if (remainingTabs.length > 0) {
                //setActiveTab(remainingTabs[remainingTabs.length - 1])
                virtualFS.setTreeObjectItemBool(remainingTabs[remainingTabs.length - 1].id, "isSelected")
            } else {
                //setActiveTab(null)
                setSelectedFile(virtualFS.createEmptyFile(rootFolder));
            }
        }
    };

    monaco.editor.onDidCreateEditor(async () => {
        await setupVirtualWorkspace(rootFolder, pluginTemplate)
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
        const editorService = codeEditor._codeEditorService;
        const openEditorBase = editorService.openCodeEditor.bind(editorService);
        editorService.openCodeEditor = async (input, source) => {
            const result = await openEditorBase(input, source);
            if (result === null) {
                setJumpTo({
                    model: monaco.editor.getModel(input.resource),
                    options: {
                        selection: input.options.selection
                    }
                })
            }
            return result; // always return the base result
        };
    }, [codeEditor]);

    useEffect(() => {
        if (jumpTo) {
            if (jumpTo.model) {
                const filePath = virtualFS.getFileName(jumpTo.model)
                addTab(virtualFS.getTreeObjectItemById(filePath))
                codeEditor.setModel(jumpTo.model);
                codeEditor.setSelection(jumpTo.options.selection);
            }
        }
    }, [jumpTo]);

    useEffect(() => {
        if (selectedFile) {
            addTab(selectedFile)
        }
    }, [selectedFile]);

    function handleEditorChange(value) {
        const path = selectedFile.id;
        if (path === "Untitled") {
            return
        }
        console.log(value)
    }

    const openCodePaletteShow = () => {
        codeEditor.focus();
        codeEditor.trigger("", "editor.action.quickCommand", "");
        const input = document.querySelector(".quick-input-box .input");
        input.value = "";
        input.dispatchEvent(new Event("input", {bubbles: true}));
    }

    const updatePaletteLeft = () => {
        const inputElement = document.getElementsByClassName("editor-header-search");
        if (inputElement) {
            const rect = inputElement[0].getBoundingClientRect();
            document.documentElement.style.setProperty("--palette-left", `50+${rect.left}px`);
        }
    };

    useEffect(() => {
        window.addEventListener("resize", updatePaletteLeft);
        updatePaletteLeft(); // Initial update

        const unsubscribe = virtualFS.subscribe("fileSelected", setSelectedFile);

        return () => {
            window.removeEventListener("resize", updatePaletteLeft)
            unsubscribe()
        }
    }, []);

    return (
        <>
            <div className="editor-header">
                <div className="editor-header-left">
                    <Button icon="arrow-left" minimal={true} disabled={true} aria-label="arrow-left"/>
                    <Button icon="arrow-right" minimal={true} disabled={true} aria-label="arrow-right"/>
                </div>
                <div className="editor-header-center">
                    <InputGroup
                        leftIcon={"search"}
                        placeholder={selectedFile?.label}
                        round={true} fill={true} small={true}
                        inputClassName={"editor-header-search"} onClick={() => openCodePaletteShow()}
                    />
                </div>
                <div className="editor-header-right">Right Content</div>
            </div>
            <Split
                minSize={250}
                render={({
                             getGridProps,
                             getGutterProps,
                         }) => (
                    <div className="bp5-dark grid-container" {...getGridProps()}>
                        <div className="file-explorer">
                            <Card style={{height: "100%"}}>
                                <FileBrowserComponent/>
                            </Card>
                        </div>
                        <div className="gutter" {...getGutterProps('column', 1)}></div>
                        <div id={"code-editor"} className="code-editor">
                            <FileTabs activeTab={activeTab} setActiveTab={setActiveTab}
                                      openTabs={openTabs} closeTab={closeTab} codeEditor={codeEditor}/>
                            <Editor height="100vh" defaultLanguage="plaintext"
                                    onChange={handleEditorChange}
                                    theme="vs-dark"
                                    defaultValue={packageDefaultContent(rootFolder)}
                                    path={selectedFile?.id}
                                    className={"editor-container"}
                                    onMount={(editor) => {
                                        setCodeEditor(editor)
                                    }}
                                    options={{
                                        minimap: {enabled: true},
                                        scrollbar: {vertical: "hidden", horizontal: "auto"},
                                        fontSize: 13,
                                    }}
                            />
                        </div>
                    </div>
                )}
            />
        </>
    );
}