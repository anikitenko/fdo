import {Breadcrumbs, Button, Tooltip} from "@blueprintjs/core";
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
    const [tabsOverflow, setTabsOverflow] = useState(false);
    const interactionsBlocked = restoreLoading;

    useEffect(() => {
        const content = contentScrollRef.current;
        const mirror = mirrorRef.current;
        if (!content || !mirror) return;
        const update = () => {
            mirror.style.width = `${content.scrollWidth}px`;
            setTabsOverflow(content.scrollWidth > content.clientWidth + 1);
        };
        update();
        const observer = new ResizeObserver(update);
        observer.observe(content);
        for (const child of content.children) observer.observe(child);
        const active = content.querySelector('[aria-selected="true"]');
        if (active) {
            const item = active.closest(`.${styles.fileTabItem}`);
            if (item && item.offsetLeft < content.scrollLeft) content.scrollLeft = item.offsetLeft;
            else if (item && item.offsetLeft + item.offsetWidth > content.scrollLeft + content.clientWidth) content.scrollLeft = item.offsetLeft + item.offsetWidth - content.clientWidth;
        }
        return () => observer.disconnect();
    }, [tabs]);

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
        if (!restoreLoading) return;
        let cancelled = false;
        const sync = () => {
            if (cancelled) return;
            if (!virtualFS.fs.getRestoreLoading()) {
                setRestoreLoading(false);
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
            <div className={classnames(styles["file-tabs-mirror"], restoreLoading && styles["subtleBusySurface"])}
                 ref={topScrollRef} data-overflow={tabsOverflow} aria-label="Scroll open files">
                <div ref={mirrorRef} style={{height: "1px"}}></div>
            </div>
            <div className={classnames(styles["file-tabs"], restoreLoading && styles["subtleBusySurface"])}
                 ref={contentScrollRef} role="tablist" aria-label="Open files">
                {tabs.map((tab, index) => (
                    <div key={tab.id} className={classnames(styles.fileTabItem,tab.active && styles.active)}>
                        <Tooltip content={
                            tab.markers?.length > 0 ? tab.markers?.map((m) => {
                                return `${m.message} (Here: ${m.startLineNumber}:${m.startColumn})\t`
                            }) : tab.id
                        } placement={"bottom"}
                                 className={styles["file-tab-tooltip"]} compact={true} hoverOpenDelay={500}>
                            <Button variant="minimal" icon={tab.icon} size={"small"} role="tab" aria-selected={!!tab.active} aria-label={tab.label} title={tab.id}
                                    tabIndex={tab.active ? 0 : -1}
                                    onKeyDown={event => {
                                        if (interactionsBlocked || !['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
                                        event.preventDefault();
                                        const next=event.key==='Home'?0:event.key==='End'?tabs.length-1:(index+(event.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;
                                        virtualFS.tabs.setActiveTab(tabs[next]);
                                        event.currentTarget.closest('[role="tablist"]')?.querySelectorAll('[role="tab"]')[next]?.focus();
                                    }}
                                    className={`
                        ${styles["file-tab"]} 
                        ${tab.active ? styles["active"] : ""} 
                        `}
                                    disabled={interactionsBlocked}
                                    onClick={() => {
                                        if (interactionsBlocked) return;
                                        virtualFS.tabs.setActiveTab(tab)
                                    }}><span>{tab.label}</span>{tab.markers?.length > 0 && <span className={styles.fileTabDiagnostics} data-severity={tab.markers.some(marker => marker.severity === 8) ? 'error' : 'warning'} aria-label={`${tab.markers.length} diagnostics`}>{tab.markers.length}</span>}</Button>
                        </Tooltip>
                        <Button variant="minimal" icon={"cross"} size={"small"}
                                aria-label={`Close ${tab.label}`} title={`Close ${tab.label}`}
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
                    </div>
                ))}
            </div>
            <div className={styles.fileBreadcrumbs}>
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
