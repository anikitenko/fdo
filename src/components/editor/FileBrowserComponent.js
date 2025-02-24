import {useEffect, useState} from "react";
import virtualFS from "./utils/VirtualFS";
import {getIconForFolder, getIconForOpenFolder} from "vscode-icons-js";

import {useContextMenu} from 'react-contexify';
import 'react-contexify/ReactContexify.css';
import {Tree} from "@blueprintjs/core";
import ContextMenu from "./context_menu/CONTEXT_MENU";

const FileBrowserComponent = () => {
    const [treeData, setTreeData] = useState(virtualFS.getTreeObjectSortedAsc())
    const {show} = useContextMenu();

    useEffect(() => {
        const unsubscribe = virtualFS.subscribe("treeUpdate", setTreeData);
        return () => unsubscribe(); // Cleanup
    }, []);

    // Handle expand/collapse
    const handleNodeExpand = (node) => {
        virtualFS.updateTreeObjectItem(node.id, {
            isExpanded: true,
            icon: <img className={"file-tree-icon"} src={"/assets/icons/vscode/" + getIconForOpenFolder(node.label)} width="20" height="20"
                       alt="icon"/>
        })
    };

    const handleNodeCollapse = (node) => {
        virtualFS.updateTreeObjectItem(node.id, {
            isExpanded: false,
            icon: <img className={"file-tree-icon"} src={"/assets/icons/vscode/" + getIconForFolder(node.label)} width="20" height="20"
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

    const handleContextMenu = (node, path, event) => {
        let menuId = "CONTEXT_MENU";
        show({
            event: event, props: {
                node: node
            }, id: menuId
        })
    };

    return (
        <>
            <Tree
                compact={true}
                contents={treeData}
                onNodeClick={handleNodeClick}
                onNodeExpand={handleNodeExpand}
                onNodeCollapse={handleNodeCollapse}
                onNodeContextMenu={handleContextMenu}
                className={"file-tree"}
            />
            <ContextMenu />
        </>
    )
}

export default FileBrowserComponent;
