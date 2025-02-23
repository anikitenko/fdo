import {useLocation} from "react-router-dom";
import PropTypes from 'prop-types';
import Split from "react-split-grid";
import {getIconForFile, getIconForFolder, getIconForOpenFolder} from 'vscode-icons-js';
import * as monaco from 'monaco-editor';
import {Editor, loader} from '@monaco-editor/react';

import './EditorPage.css'
//import './Monaco.css'
import {useEffect, useRef, useState} from "react";
import {Button, Card, InputGroup, Menu, MenuItem, showContextMenu, Tooltip, Tree} from "@blueprintjs/core";
import {FDO_SDK} from "@anikitenko/fdo-sdk";
import {setupVirtualWorkspace} from "./utils/setupVirtualWorkspace";
import {VirtualFS} from "./utils/VirtualFS";

const itemInTree = (id, type = "file", isExpanded = false) => {
    const name = id.split("/").pop();
    const iconExpanded = isExpanded ? "/assets/icons/vscode/" + getIconForOpenFolder(name) : "/assets/icons/vscode/" + getIconForFolder(name)
    return {
        id,
        label: name,
        type: type,
        icon: <img src={type === "folder" ? iconExpanded : "/assets/icons/vscode/" + getIconForFile(name)}
                   width="16" height="16" alt="icon"/>,
        isExpanded,
        hasCaret: type === "folder",
        className: "mouse-pointer",
        childNodes: type === "folder" ? [] : undefined,
    }
}

function buildFileTree(paths, rootId = "", name="") {
    const root = itemInTree(name, "folder", true); // Root is expanded
    const nodeMap = { [rootId]: root };

    paths.sort(); // Ensure sorting before processing

    paths.forEach((filePath) => {
        if (filePath.includes("__default_new_file__.txt")) {
            return
        }
        const parts = filePath.split("/").filter(Boolean);
        let currentPath = rootId;
        let currentNode = root;

        parts.forEach((part, index) => {
            const isLast = index === parts.length - 1;
            const fullPath = `${currentPath}/${part}`;

            if (!nodeMap[fullPath] && fullPath !== rootId) { // Exclude rootId from child nodes
                const isFolder = !isLast;
                const newNode = itemInTree(fullPath, isFolder ? "folder" : "file", false);
                nodeMap[fullPath] = newNode;

                if (!currentNode.childNodes) {
                    currentNode.childNodes = [];
                }
                currentNode.childNodes.push(newNode);
            }

            currentNode = nodeMap[fullPath];
            currentPath = fullPath;
        });
    });

    // Sort children: directories first, then files
    function sortChildren(node) {
        if (node.childNodes) {
            node.childNodes.sort((a, b) => {
                if (a.type === "folder" && b.type === "file") return -1;
                if (a.type === "file" && b.type === "folder") return 1;
                return a.label.localeCompare(b.label);
            });
            node.childNodes.forEach(sortChildren);
        }
    }

    sortChildren(root);
    return root;
}

const FileBrowser = ({name, files, setSelectedFile, addTab, switchFilePath}) => {
    const [treeData, setTreeData] = useState([]);

    const findNodeByIdIterative = (id) => {
        const stack = [...treeData];

        while (stack.length) {
            const node = stack.pop();
            if (node.id === id) return node;
            if (node.childNodes?.length) stack.push(...node.childNodes);
        }

        return null;
    };

    useEffect(() => {
        const blueprintTree = buildFileTree(files, "", name);
        setTreeData([blueprintTree]);
    }, [files]);

    useEffect(() => {
        if (switchFilePath && switchFilePath !== "") {
            const node = findNodeByIdIterative(switchFilePath);
            setSelectedFile(node);
            addTab(node);
        }
    }, [switchFilePath]);

    const treeRef = useRef(null);

    // Recursively find and update a node immutably
    const updateTreeNode = (nodes, nodeId, changes) => {
        return nodes.map((n) => {
            if (n.id === nodeId) {
                return {...n, ...changes}; // Create a new object with updates
            } else if (n.childNodes) {
                return {...n, childNodes: updateTreeNode(n.childNodes, nodeId, changes)};
            }
            return n;
        });
    };

    const updateSelectedNode = (nodes, nodeId) => {
        return nodes.map((n) => {
            if (n.id === nodeId) {
                return {...n, isSelected: true}; // Create a new object with updates
            } else {
                return {
                    ...n, isSelected: false, // Ensure all other nodes are false
                    childNodes: n.childNodes ? updateSelectedNode(n.childNodes, nodeId) : n.childNodes
                };
            }
        });
    };

    // Handle expand/collapse
    const handleNodeExpand = (node) => {
        setTreeData((prevTree) => updateTreeNode(prevTree, node.id, {
            isExpanded: true,
            icon: <img src={"/assets/icons/vscode/" + getIconForOpenFolder(node.label)} width="16" height="16"
                       alt="icon"/>
        }));
    };

    const handleNodeCollapse = (node) => {
        setTreeData((prevTree) => updateTreeNode(prevTree, node.id, {
            isExpanded: false,
            icon: <img src={"/assets/icons/vscode/" + getIconForFolder(node.label)} width="16" height="16" alt="icon"/>
        }));
    };

    // Handle file selection
    const handleNodeClick = (node) => {
        if (node.type === "file") {
            setSelectedFile(node);
            addTab(node);
            setTreeData((prevTree) => updateSelectedNode(prevTree, node.id));
        } else {
            node.isExpanded ? handleNodeCollapse(node) : handleNodeExpand(node);
        }
    };


    const handleContextMenu = (node, path, e) => {
        const nodeClicked = treeRef.current.getNodeContentElement(node.id);
        showContextMenu({
            content: (
                <Menu className={"editor-context-menu"} small={true}>
                    <MenuItem className={"editor-context-menu-item"} text="Save"/>
                    <MenuItem className={"editor-context-menu-item"} text="Save as..."/>
                    <MenuItem className={"editor-context-menu-item"} text="Delete..." intent="danger"/>
                </Menu>
            ),
            targetOffset: {left: e.clientX, top: e.clientY},
            onClose: () => {
                nodeClicked.focus();
            },
        })
    };

    return (
        <Tree
            ref={treeRef}
            compact={true}
            contents={treeData}
            onNodeClick={handleNodeClick}
            onNodeExpand={handleNodeExpand}
            onNodeCollapse={handleNodeCollapse}
            onNodeContextMenu={handleContextMenu}
        />
    )
}
FileBrowser.propTypes = {
    name: PropTypes.string.isRequired,
    files: PropTypes.array.isRequired,
    setSelectedFile: PropTypes.func.isRequired,
    addTab: PropTypes.func.isRequired,
    switchFilePath: PropTypes.any
};

const FileTabs = ({openTabs, activeFile, setActiveFile, closeTab, setSelectedFile}) => (
    <div className={"file-tabs"}>
        {openTabs.map((file) => (
            <div role={"button"} key={file.id}
                 className={"file-tab" + (file.id === activeFile.id ? " active" : "")}
                 onClick={() => {
                     setActiveFile(file);
                     setSelectedFile(file)
                 }}
            >
                <Tooltip content={file.id} placement={"bottom-end"} minimal={true} lazy={true}
                         className={"file-tab-tooltip"}>
                    {file.label}
                </Tooltip>
                {file.icon}
                <span role={"button"}
                      className={"close-tab-btn"}
                      onClick={(e) => {
                          e.stopPropagation();
                          closeTab(file);
                      }}
                >
          ✕
                </span>
            </div>
        ))}
    </div>
);
FileTabs.propTypes = {
    openTabs: PropTypes.array.isRequired,
    activeFile: PropTypes.any,
    setActiveFile: PropTypes.func.isRequired,
    closeTab: PropTypes.func.isRequired,
    setSelectedFile: PropTypes.func.isRequired,
}

export const EditorPage = () => {
    document.title = "Plugin Editor";
    loader.config({monaco});
    const virtualFS = new VirtualFS();

    const location = useLocation();
    // Extract data from the query parameter
    const searchParams = new URLSearchParams(location.search);
    const pluginData = JSON.parse(decodeURIComponent(searchParams.get("data") || "{}"));
    const rootFolder = FDO_SDK.generatePluginName(pluginData.name)
    const pluginTemplate = pluginData.template


    const [codeEditor, setCodeEditor] = useState(null)
    const [selectedFile, setSelectedFile] = useState(null);
    const [openTabs, setOpenTabs] = useState([]);
    const [activeFile, setActiveFile] = useState(null);
    const [defaultFileContent, setDefaultFileContent] = useState("")
    const [defaultNewFile, setDefaultNewFile] = useState(null);
    const [treeFilesPaths, setTreeFilesPaths] = useState([])
    const [switchFilePath, setSwitchFilePath] = useState("")
    const addTab = (file) => {
        if (!openTabs.some((tab) => tab.id === file.id)) {
            setOpenTabs((prevTabs) => [...prevTabs, file]);
        }
        setActiveFile(file);
    };
    const closeTab = (file) => {
        setOpenTabs((prevTabs) => prevTabs.filter((tab) => tab.id !== file.id));

        // If closing the active file, switch to the first open tab
        if (activeFile.id === file.id) {
            const remainingTabs = openTabs.filter((tab) => tab.id !== file.id);
            if (remainingTabs.length > 0) {
                setActiveFile(remainingTabs[remainingTabs.length - 1])
                setSelectedFile(remainingTabs[remainingTabs.length - 1])
            } else {
                setActiveFile(null);
                setSelectedFile(defaultNewFile);
            }
        }
    };

    monaco.editor.onDidCreateEditor(async () => {
        const result = await setupVirtualWorkspace(rootFolder, pluginTemplate)
        for (const idx in result.models) {
            virtualFS.createFile(result.models[idx].filePath, result.models[idx].model)
        }
        virtualFS.createFile(result.defaultFile.filePath, result.defaultFile.model)
        const defaultFile = itemInTree(result.defaultFile.filePath)
        virtualFS.createFile(result.defaultNewFile.filePath, result.defaultNewFile.model)
        setTreeFilesPaths(virtualFS.listFiles())
        setDefaultNewFile(itemInTree(result.defaultNewFile.filePath))
        setSelectedFile(defaultFile)
        setOpenTabs([defaultFile])
        setActiveFile(defaultFile)
        setDefaultFileContent(result.sampleFileContent)
    })

    useEffect(() => {
        if (!codeEditor) return;
        codeEditor.addCommand(
            monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyF, // CTRL/CMD + S
            () => {
                let itm = document.getElementById("code-editor");
                if (itm.requestFullscreen) {
                    itm.requestFullscreen();
                }
            }
        );
        const editorService = codeEditor._codeEditorService;
        const openEditorBase = editorService.openCodeEditor.bind(editorService);
        editorService.openCodeEditor = async (input, source) => {
            const result = await openEditorBase(input, source);
            if (result === null) {
                const filePath = virtualFS.getFileName(monaco.editor.getModel(input.resource))
                setSwitchFilePath(filePath)
            }
            return result; // always return the base result
        };
    }, [codeEditor]);

    useEffect(() => {
        if (selectedFile) {
            codeEditor.setModel(virtualFS.getModel(selectedFile.id))
        }
    }, [selectedFile]);

    function handleEditorChange(value, event) {
        const path = selectedFile.id;
        console.log(path)
        //setFiles({ ...files, [activeFile]: value });
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

        return () => window.removeEventListener("resize", updatePaletteLeft);
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
                                <FileBrowser name={rootFolder} setSelectedFile={setSelectedFile} addTab={addTab} files={treeFilesPaths} switchFilePath={switchFilePath}/>
                            </Card>
                        </div>
                        <div className="gutter" {...getGutterProps('column', 1)}></div>
                        <div id={"code-editor"} className="code-editor">
                            <FileTabs activeFile={activeFile} setActiveFile={setActiveFile}
                                      openTabs={openTabs} closeTab={closeTab} setSelectedFile={setSelectedFile}/>
                            <Editor height="100vh" defaultLanguage="plaintext"
                                    onChange={handleEditorChange}
                                    theme="vs-dark"
                                    defaultValue={defaultFileContent}
                                    path={selectedFile?.id}
                                    className={"editor-container"}
                                    onMount={(editor) => {
                                        setCodeEditor(editor)
                                    }}
                                    options={{
                                        minimap: {enabled: false},
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