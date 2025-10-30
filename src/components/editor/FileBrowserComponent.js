import {useEffect, useState} from "react";
import virtualFS from "./utils/VirtualFS";
import {getIconForFolder, getIconForOpenFolder} from "vscode-icons-js";
import * as styles from './EditorPage.module.css'

import {useContextMenu} from 'react-contexify';
import 'react-contexify/ReactContexify.css';
import {Tree} from "@blueprintjs/core";
import ContextMenu from "./context_menu/CONTEXT_MENU";
import classnames from "classnames";

const FileBrowserComponent = () => {
    const [treeData, setTreeData] = useState(virtualFS.getTreeObjectSortedAsc())
    // ALWAYS initialize with false - skeleton should NEVER appear during initial load
    // Only show skeleton on explicit user actions (version switch, snapshot create)
    const [treeLoading, setTreeLoading] = useState(false)
    const [contextElement, setContextElement] = useState(null)
    const {show} = useContextMenu();

    useEffect(() => {
        const unsubscribe = virtualFS.notifications.subscribe("treeUpdate", setTreeData);
        const unsubscribeLoading = virtualFS.notifications.subscribe("treeLoading", setTreeLoading);
        return () => {
            unsubscribe();
            unsubscribeLoading();
        }
    }, []);

    // Handle expand/collapse
    const handleNodeExpand = (node) => {
        virtualFS.updateTreeObjectItem(node.id, {
            isExpanded: true,
            icon: <img className={styles["file-tree-icon"]} src={"static://assets/icons/vscode/" + getIconForOpenFolder(node.label)} width="20" height="20"
                       alt="icon"/>
        })
    };

    const handleNodeCollapse = (node) => {
        virtualFS.updateTreeObjectItem(node.id, {
            isExpanded: false,
            icon: <img className={styles["file-tree-icon"]} src={"static://assets/icons/vscode/" + getIconForFolder(node.label)} width="20" height="20"
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
        setContextElement(node)
        show({
            event: event, props: {
                node: node
            }, id: menuId
        })
    };

    return (
        <>
            <Tree
                contents={treeData}
                onNodeClick={handleNodeClick}
                onNodeExpand={handleNodeExpand}
                onNodeCollapse={handleNodeCollapse}
                onNodeContextMenu={handleContextMenu}
                className={classnames(styles["file-tree"], treeLoading ? "bp6-skeleton" : "")}
            />
            <ContextMenu contextElement={contextElement} />
        </>
    )
}

export default FileBrowserComponent;
