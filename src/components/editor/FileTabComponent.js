import {Breadcrumbs, Button, ButtonGroup, Tooltip} from "@blueprintjs/core";
import PropTypes from 'prop-types';
import virtualFS from "./utils/VirtualFS";
import * as styles from './EditorPage.module.css'
import React from "react";
import {useEffect, useRef, useState} from "react";
import classnames from "classnames";
import {getIconForFile, getIconForOpenFolder} from "vscode-icons-js";

const FileTabs = ({closeTab}) => {
    const [tabs, setTabs] = useState(virtualFS.tabs.get())
    const [treeLoading, setTreeLoading] = useState(virtualFS.fs.getLoading())
    const [restoreLoading, setRestoreLoading] = useState(virtualFS.fs.getRestoreLoading())
    const [nodeModulesLoading, setNodeModulesLoading] = useState(virtualFS.fs.getNodeModulesLoading())
    const topScrollRef = useRef(null);
    const contentScrollRef = useRef(null);
    const mirrorRef = useRef(null);
    const interactionsBlocked = restoreLoading || nodeModulesLoading;

    useEffect(() => {
        const unsubscribeFileTabs = virtualFS.notifications.subscribe("fileTabs", setTabs);
        const unsubscribeTabSwitched = virtualFS.notifications.subscribe("tabSwitched", () => setTabs(virtualFS.tabs.get()));
        const unsubscribeLoading = virtualFS.notifications.subscribe("treeLoading", setTreeLoading);
        const unsubscribeRestoreLoading = virtualFS.notifications.subscribe("restoreLoading", setRestoreLoading);
        const unsubscribeNodeModulesLoading = virtualFS.notifications.subscribe("nodeModulesLoading", setNodeModulesLoading);

        // Ensure initial state is in sync even if no events fire immediately
        setTabs(virtualFS.tabs.get());
        setTreeLoading(virtualFS.fs.getLoading());
        setRestoreLoading(virtualFS.fs.getRestoreLoading());
        setNodeModulesLoading(virtualFS.fs.getNodeModulesLoading());

        const top = topScrollRef.current;
        const content = contentScrollRef.current;
        const mirror = mirrorRef.current;

        let resizeObserver;
        const updateMirrorWidth = () => {
            if (!mirror || !content) return;
            mirror.style.width = content.scrollWidth + "px";
        };

        if (top && content && mirror) {
            updateMirrorWidth(); // Set initially

            const syncTop = () => { top.scrollLeft = content.scrollLeft; };
            const syncBottom = () => { content.scrollLeft = top.scrollLeft; };

            top.addEventListener("scroll", syncBottom);
            content.addEventListener("scroll", syncTop);

            // ResizeObserver for dynamic content
            resizeObserver = new ResizeObserver(updateMirrorWidth);
            resizeObserver.observe(content);

            return () => {
                unsubscribeFileTabs();
                unsubscribeTabSwitched();
                unsubscribeLoading();
                unsubscribeRestoreLoading();
                unsubscribeNodeModulesLoading();

                top.removeEventListener("scroll", syncBottom);
                content.removeEventListener("scroll", syncTop);
                if (resizeObserver) resizeObserver.disconnect();
            };
        }

        // If refs are not ready yet, still return a cleanup for subscriptions
        return () => {
            unsubscribeFileTabs();
            unsubscribeTabSwitched();
            unsubscribeLoading();
            unsubscribeRestoreLoading();
            unsubscribeNodeModulesLoading();
            if (resizeObserver) resizeObserver.disconnect();
        };
    }, []);

    useEffect(() => {
        if (typeof window === "undefined") return;
        if (window.localStorage?.getItem("editor.restoreDebug") !== "true") return;
        window.dispatchEvent(new CustomEvent("editor-render-debug", {
            detail: {
                component: "tabs"
            }
        }));
    });

    return (
        <div className={classnames(styles["file-tabs-wrapper"])}>
            {(treeLoading || restoreLoading || nodeModulesLoading) && (
                <div className={styles["editorSubtleStatus"]} role="status" aria-live="polite">
                    <span className={styles["editorSubtleStatusDot"]}></span>
                    <span>
                        {treeLoading
                            ? "Refreshing files…"
                            : restoreLoading
                                ? "Restoring tabs and editor state…"
                                : "Loading project types…"}
                    </span>
                </div>
            )}
            <div className={classnames(styles["file-tabs-mirror"], (restoreLoading || nodeModulesLoading) && styles["subtleBusySurface"])}
                 ref={topScrollRef}>
                <div ref={mirrorRef} style={{height: "1px"}}></div>
            </div>
            <div className={classnames(styles["file-tabs"], (restoreLoading || nodeModulesLoading) && styles["subtleBusySurface"])} style={{height: "39px"}}
                 ref={contentScrollRef}>
                {tabs.map((tab) => (
                    <ButtonGroup key={tab.id}>
                        <Tooltip content={
                            tab.markers?.length > 0 ? tab.markers?.map((m) => {
                                return `${m.message} (Here: ${m.startLineNumber}:${m.startColumn})\t`
                            }) : tab.id
                        } placement={"bottom"}
                                 className={styles["file-tab-tooltip"]} compact={true} hoverOpenDelay={500}>
                            <Button icon={tab.icon} size={"medium"}
                                    className={`
                        ${styles["file-tab"]} 
                        ${tab.markers?.length > 0 ? styles["file-tab-marker"] : ""}
                        ${tab.active ? styles["active"] : ""} 
                        `}
                                    disabled={interactionsBlocked}
                                    onClick={() => {
                                        if (interactionsBlocked) return;
                                        virtualFS.tabs.setActiveTab(tab)
                                    }} text={tab.label}
                            />
                        </Tooltip>
                        <Button icon={"cross"} size={"small"}
                                className={`
                    ${styles["close-tab-btn"]} 
                    ${styles["file-tab"]} 
                    ${tab.active ? styles["active"] : ""} 
                    `}
                                disabled={interactionsBlocked}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    if (interactionsBlocked) return;
                                    closeTab(tab.id)
                                }}
                        >
                        </Button>
                    </ButtonGroup>
                ))}
            </div>
            <div style={{flexBasis: "100%", background: "#212733", paddingLeft: "15px"}}>
                <Breadcrumbs
                    items={(() => {
                        const parts = (virtualFS.tabs.getActiveTabId() ?? "").split("/").filter(Boolean);
                        parts.unshift(virtualFS.pluginName)
                        return parts.map((segment, index) => ({
                            text: segment,
                            current: index === parts.length - 1,
                        }));
                    })()}
                    minVisibleItems={3}
                    collapseFrom="start"
                    breadcrumbRenderer={(item, index) => (
                        <span key={index} style={{display: "flex", alignItems: "center", gap: 2, fontSize: "75%"}}>
                            {item.current ? (
                                <img
                                     src={"static://assets/icons/vscode/" + getIconForFile(item.text)} width="20"
                                     height="20"
                                     alt="icon"/>
                            ) : (
                                <img
                                     src={"static://assets/icons/vscode/" + getIconForOpenFolder(item.text)} width="20"
                                     height="20"
                                     alt="icon"/>
                            )}
                            <span
                                aria-current={item.current ? "page" : undefined}
                                style={item.current ? {fontWeight: "bold", color: "white"} : {color: "white"}}
                            >
                                {item.text}
                            </span>
                        </span>
                    )}
                />
            </div>
        </div>
    )
}
FileTabs.propTypes = {
    closeTab: PropTypes.func
}

export default FileTabs
