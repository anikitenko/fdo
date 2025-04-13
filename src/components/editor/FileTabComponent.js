import {Breadcrumbs, Button, ButtonGroup, Tooltip} from "@blueprintjs/core";
import PropTypes from 'prop-types';
import virtualFS from "./utils/VirtualFS";
import * as styles from './EditorPage.module.css'
import {useEffect, useRef, useState} from "react";
import classnames from "classnames";
import {getIconForFile, getIconForOpenFolder} from "vscode-icons-js";

const FileTabs = ({closeTab}) => {
    const [tabs, setTabs] = useState([])
    const [treeLoading, setTreeLoading] = useState(virtualFS.fs.getLoading())
    const topScrollRef = useRef(null);
    const contentScrollRef = useRef(null);
    const mirrorRef = useRef(null);

    useEffect(() => {
        const unsubscribe = virtualFS.notifications.subscribe("fileTabs", setTabs);
        const unsubscribeLoading = virtualFS.notifications.subscribe("treeLoading", setTreeLoading);

        const top = topScrollRef.current;
        const content = contentScrollRef.current;
        const mirror = mirrorRef.current;

        if (!top || !content || !mirror) return;

        const updateMirrorWidth = () => {
            mirror.style.width = content.scrollWidth + "px";
        };

        updateMirrorWidth(); // Set initially

        const syncTop = () => {
            top.scrollLeft = content.scrollLeft;
        };
        const syncBottom = () => {
            content.scrollLeft = top.scrollLeft;
        };

        top.addEventListener("scroll", syncBottom);
        content.addEventListener("scroll", syncTop);

        // ResizeObserver for dynamic content
        const resizeObserver = new ResizeObserver(updateMirrorWidth);
        resizeObserver.observe(content);

        // Cleanup
        return () => {
            unsubscribe();
            unsubscribeLoading();

            top.removeEventListener("scroll", syncBottom);
            content.removeEventListener("scroll", syncTop);
            resizeObserver.disconnect();
        };
    }, [tabs]);

    return (
        <div className={classnames(styles["file-tabs-wrapper"])}>
            <div className={classnames(styles["file-tabs-mirror"], treeLoading ? "bp5-skeleton" : "")}
                 ref={topScrollRef}>
                <div ref={mirrorRef} style={{height: "1px"}}></div>
            </div>
            <div className={classnames(styles["file-tabs"], treeLoading ? "bp5-skeleton" : "")} style={{height: "39px"}}
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
                                    onClick={() => {
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
                                onClick={(e) => {
                                    e.stopPropagation();
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
