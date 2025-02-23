import {useEffect, useRef, useState} from "react";
import virtualFS from "./utils/VirtualFS";
import {getIconForFolder, getIconForOpenFolder} from "vscode-icons-js";
import {Menu, MenuItem, showContextMenu, Tree} from "@blueprintjs/core";

const FileBrowserComponent = () => {
    const [treeData, setTreeData] = useState(virtualFS.getTreeObjectSortedAsc())
    const treeRef = useRef(null)

    useEffect(() => {
        const unsubscribe = virtualFS.subscribe("treeUpdate", setTreeData);
        return () => unsubscribe(); // Cleanup
    }, []);

    // Handle expand/collapse
    const handleNodeExpand = (node) => {
        virtualFS.updateTreeObjectItem(node.id, {
            isExpanded: true,
            icon: <img src={"/assets/icons/vscode/" + getIconForOpenFolder(node.label)} width="16" height="16"
                       alt="icon"/>
        })
    };

    const handleNodeCollapse = (node) => {
        virtualFS.updateTreeObjectItem(node.id, {
            isExpanded: false,
            icon: <img src={"/assets/icons/vscode/" + getIconForFolder(node.label)} width="16" height="16"
                       alt="icon"/>
        })
    };

    // Handle file selection
    const handleNodeClick = (node) => {
        if (node.type === "file") {
            virtualFS.setTreeObjectItemBool(node.id, "isSelected")
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

export default FileBrowserComponent;
