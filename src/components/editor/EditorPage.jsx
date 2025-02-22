import {useLocation} from "react-router-dom";
import Split from "react-split-grid";
import * as monaco from 'monaco-editor';
import {Editor, loader, useMonaco} from '@monaco-editor/react';

import './EditorPage.css'
import {useEffect, useRef, useState} from "react";
import {Button, Card, InputGroup, Menu, MenuItem, showContextMenu, Tab, Tabs, Tree} from "@blueprintjs/core";
import {FDO_SDK} from "@anikitenko/fdo-sdk";

function EXAMPLE(name) {
    const data_class_header = `import {FDO_SDK, FDOInterface, PluginMetadata} from '@anikitenko/fdo-sdk';

class MyPlugin extends FDO_SDK implements FDOInterface {
`
    const data_metadata = `
    private readonly _metadata: PluginMetadata = {
        name: "${name}",
        version: "1.0.2",
        author: "AleXvWaN",
        description: "A sample FDO plugin",
        icon: "COG",
    };`
    const data_constructor = `
    constructor() {
        super();
    }
    `
    const data_get_metadata = `
    public get metadata(): PluginMetadata {
        return this._metadata;
    }
    `
    const data_init = `
    public init(sdk: FDO_SDK): void {
        sdk.log("MyPlugin initialized!");
    }
    `
    const data_render = "" +
        "   public render(): string {\n" +
        "        return (`\n" +
        "           <div>\n" +
        "                <h1>MyPlugin</h1>\n" +
        "                <p>Version: ${this._metadata.version}</p>\n" +
        "                <p>Author: ${this._metadata.author}</p>\n" +
        "                <p>Description: ${this._metadata.description}</p>\n" + "" +
        "            </div>\n" +
        "        `)\n" +
        "    }"
    const data_class_footer = `
}
export default MyPlugin;
`
    return data_class_header + data_metadata + data_constructor + data_get_metadata + data_init + data_render + data_class_footer;
}

const newFile = (name, rootFolder, content) => {
    return {
        content: content,
        language: "typescript",
        id: rootFolder + "/" + name,
        label: name,
        type: "file",
        icon: "code",
        isExpanded: false,
        hasCaret: false,
        className: "mouse-pointer",
    }
}

const transformToTreeNode = (root, node) => {
    const path = node.path || ""
    return {
        id: root + "/" + path,
        label: node.name,
        language: node.language || "",
        type: node.type,
        icon: node.type === "folder" ? "folder-close" : "code",
        isExpanded: path === "",
        isSelected: false,
        content: node.content || "", // Store full node info
        hasCaret: node.type === "folder",
        className: "mouse-pointer file-item",
        childNodes: node.children ? node.children.map((child, index) => transformToTreeNode(root, child)) : []
    };
};

const FileBrowser = ({name, setSelectedFile, addTab}) => {
    const [treeData, setTreeData] = useState([]);

    useEffect(() => {
        window.electron.GetEditorFilesTree(name).then(result => {
            if (result.success) {
                const blueprintTree = [transformToTreeNode(name, result.filesTree)];
                setTreeData(blueprintTree);
                setTreeData((prevTree) => {
                    if (!prevTree.length) return prevTree; // Ensure array is not empty

                    return [
                        {
                            ...prevTree[0], // Copy the first item
                            childNodes: [...(prevTree[0].childNodes || []), newFile("index.ts", name, EXAMPLE(name))] // Append new child
                        },
                        ...prevTree.slice(1) // Keep the rest unchanged
                    ];
                });
            }
        });
    }, [name]);

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
        setTreeData((prevTree) => updateTreeNode(prevTree, node.id, {isExpanded: true}));
    };

    const handleNodeCollapse = (node) => {
        setTreeData((prevTree) => updateTreeNode(prevTree, node.id, {isExpanded: false}));
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

const FileTabs = ({ openTabs, activeFile, setActiveFile, closeTab, setSelectedFile }) => (
    <div className={"file-tabs"}>
        {openTabs.map((file) => (
            <div onKeyUp={() => ("")}
                key={file.id}
                className={"file-tab" + (file.id === activeFile.id ? " active" : "")}
                onClick={() => {setActiveFile(file); setSelectedFile(file)}}
            >
                {file.label}
                <span
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

export const EditorPage = () => {
    document.title = "Plugin Editor";

    const location = useLocation();
    // Extract data from the query parameter
    const searchParams = new URLSearchParams(location.search);
    const pluginData = JSON.parse(decodeURIComponent(searchParams.get("data") || "{}"));
    const rootFolder = FDO_SDK.generatePluginName(pluginData.name)


    const [codeEditor, setCodeEditor] = useState(null)
    const [selectedFile, setSelectedFile] = useState(newFile("index.ts", rootFolder, EXAMPLE(rootFolder)));
    const [openTabs, setOpenTabs] = useState([newFile("index.ts", rootFolder, EXAMPLE(rootFolder))]);
    const [activeFile, setActiveFile] = useState(newFile("index.ts", rootFolder, EXAMPLE(rootFolder)));
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
            setActiveFile(remainingTabs.length > 0 ? remainingTabs[0] : null);
            setSelectedFile(remainingTabs.length > 0 ? remainingTabs[0] : newFile("empty_path.txt", rootFolder, ""));
        }
    };

    loader.config({
        monaco,
    });

    const monacoReact = useMonaco();

    useEffect(() => {
        // or make sure that it exists by other ways
        if (monacoReact) {
            monaco.languages.typescript.typescriptDefaults.setCompilerOptions({
                target: monaco.languages.typescript.ScriptTarget.ES2016,
                allowNonTsExtensions: true,
                moduleResolution: monaco.languages.typescript.ModuleResolutionKind.NodeJs,
                module: monaco.languages.typescript.ModuleKind.ESNext,
                typeRoots: ["node_modules"]
            });
            monaco.languages.typescript.typescriptDefaults.setDiagnosticsOptions({
                noSemanticValidation: false,
                noSyntaxValidation: false
            })
            window.electron.GetModuleFiles().then(result => {
                if (result.success) {
                    result.files.forEach(file => {
                        fetch(`/node_modules/${file}`)
                            .then((res) => res.text())
                            .then((dts) => {
                                monaco.languages.typescript.typescriptDefaults.addExtraLib(dts, `node_modules/${file}`);
                            });
                    })
                }
            });
        }
    }, [monacoReact]);

    useEffect(() => {
        if (!codeEditor) return;
        codeEditor.addCommand(
            monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, // CTRL/CMD + S
            () => {
                console.log("Want to save!");
            }
        );
    }, [codeEditor]);

    function handleEditorChange(value, event) {
        const path = selectedFile.id;
        console.log(path)
        //setFiles({ ...files, [activeFile]: value });
    }

    const openCodePalleteShow = () => {
        codeEditor.focus();
        codeEditor.trigger("", "editor.action.quickCommand", "");
        const input = document.querySelector(".quick-input-box .input");
        input.value = "";
        input.dispatchEvent(new Event("input", { bubbles: true }));
    }

    return (
        <>
            <div className="editor-header">
                <div className="editor-header-left">
                    <Button icon="arrow-left" minimal={true} disabled={true} aria-label="arrow-left" />
                    <Button icon="arrow-right" minimal={true} disabled={true} aria-label="arrow-right" />
                </div>
                <div className="editor-header-center">
                    <InputGroup
                        leftIcon={"search"}
                        placeholder={selectedFile.label}
                        round={true} fill={true} small={true}
                        inputClassName={"editor-header-search"} onClick={() => openCodePalleteShow()}
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
                            <FileBrowser name={rootFolder} setSelectedFile={setSelectedFile} addTab={addTab}/>
                        </Card>
                    </div>
                    <div className="gutter" {...getGutterProps('column', 1)}></div>
                    <div className="code-editor">
                        <FileTabs activeFile={activeFile} setActiveFile={setActiveFile}
                                  openTabs={openTabs} closeTab={closeTab} setSelectedFile={setSelectedFile}/>
                        <Editor height="100vh" defaultLanguage="typescript"
                                onChange={handleEditorChange}
                                theme="vs-dark"
                                value={selectedFile.content}
                                className={"editor-container"}
                                language={selectedFile.language}
                                onMount={(editor) => {
                                    setCodeEditor(editor)
                                }}
                                options={{
                                    minimap: { enabled: false },
                                    scrollbar: { vertical: "hidden", horizontal: "auto" },
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