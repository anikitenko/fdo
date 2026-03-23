import {useEffect, useState} from "react";
import virtualFS from "./utils/VirtualFS";
import {getIconForFolder, getIconForOpenFolder} from "vscode-icons-js";
import * as styles from './EditorPage.module.css'
import React from "react";

import {useContextMenu} from 'react-contexify';
import 'react-contexify/ReactContexify.css';
import {Tree} from "@blueprintjs/core";
import ContextMenu from "./context_menu/CONTEXT_MENU";
import classnames from "classnames";

const FileBrowserComponent = () => {
    const [treeData, setTreeData] = useState(virtualFS.getTreeObjectSortedAsc())
    const [treeLoading, setTreeLoading] = useState(virtualFS.fs.getLoading())
    const [restoreLoading, setRestoreLoading] = useState(virtualFS.fs.getRestoreLoading())
    const [nodeModulesLoading, setNodeModulesLoading] = useState(virtualFS.fs.getNodeModulesLoading())
    const [contextElement, setContextElement] = useState(null)
    const {show} = useContextMenu();
    const interactionsBlocked = restoreLoading || nodeModulesLoading;

    useEffect(() => {
        const unsubscribe = virtualFS.notifications.subscribe("treeUpdate", setTreeData);
        const unsubscribeLoading = virtualFS.notifications.subscribe("treeLoading", setTreeLoading);
        const unsubscribeRestoreLoading = virtualFS.notifications.subscribe("restoreLoading", setRestoreLoading);
        const unsubscribeNodeModulesLoading = virtualFS.notifications.subscribe("nodeModulesLoading", setNodeModulesLoading);
        return () => {
            unsubscribe();
            unsubscribeLoading();
            unsubscribeRestoreLoading();
            unsubscribeNodeModulesLoading();
        }
    }, []);

    useEffect(() => {
        if (typeof window === "undefined") return;
        if (window.localStorage?.getItem("editor.restoreDebug") !== "true") return;
        window.dispatchEvent(new CustomEvent("editor-render-debug", {
            detail: {
                component: "tree"
            }
        }));
    });

    // Handle expand/collapse
    const handleNodeExpand = (node) => {
        if (interactionsBlocked) return;
        virtualFS.updateTreeObjectItem(node.id, {
            isExpanded: true,
            icon: <img className={styles["file-tree-icon"]} src={"static://assets/icons/vscode/" + getIconForOpenFolder(node.label)} width="20" height="20"
                       alt="icon"/>
        })
    };

    const handleNodeCollapse = (node) => {
        if (interactionsBlocked) return;
        virtualFS.updateTreeObjectItem(node.id, {
            isExpanded: false,
            icon: <img className={styles["file-tree-icon"]} src={"static://assets/icons/vscode/" + getIconForFolder(node.label)} width="20" height="20"
                       alt="icon"/>
        })
    };

    // Handle file selection
    const handleNodeClick = (node) => {
        if (interactionsBlocked) return;
        if (node.type === "file") {
            virtualFS.setTreeObjectItemBool(node.id, "isSelected")
        } else {
            node.isExpanded ? handleNodeCollapse(node) : handleNodeExpand(node);
        }
    };

    const handleContextMenu = (node, path, event) => {
        if (interactionsBlocked) return;
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
            {(treeLoading || restoreLoading || nodeModulesLoading) && (
                <div className={styles["editorSubtleStatus"]} role="status" aria-live="polite">
                    <span className={styles["editorSubtleStatusDot"]}></span>
                    <span>
                        {treeLoading
                            ? "Refreshing project tree…"
                            : restoreLoading
                                ? "Restoring project tree…"
                                : "Loading dependencies and types…"}
                    </span>
                </div>
            )}
            <Tree
                contents={treeData}
                onNodeClick={handleNodeClick}
                onNodeExpand={handleNodeExpand}
                onNodeCollapse={handleNodeCollapse}
                onNodeContextMenu={handleContextMenu}
                className={classnames(styles["file-tree"], (restoreLoading || nodeModulesLoading) && styles["subtleBusySurface"])}
            />
            <ContextMenu contextElement={contextElement} />
        </>
    )
}

export default FileBrowserComponent;
