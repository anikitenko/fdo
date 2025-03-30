import {Button, ButtonGroup, Tooltip} from "@blueprintjs/core";
import PropTypes from 'prop-types';
import virtualFS from "./utils/VirtualFS";
import * as styles from './EditorPage.module.css'
import {useEffect, useState} from "react";
import classnames from "classnames";

const FileTabs = ({closeTab}) => {
    const [tabs, setTabs] = useState([])
    const [treeLoading, setTreeLoading] = useState(virtualFS.fs.getLoading())
    useEffect(() => {
        const unsubscribe = virtualFS.notifications.subscribe("fileTabs", setTabs);
        const unsubscribeLoading = virtualFS.notifications.subscribe("treeLoading", setTreeLoading);

        return () => {
            unsubscribe();
            unsubscribeLoading();
        }
    }, [])
    return (
        <div className={classnames(styles["file-tabs"], treeLoading ? "bp5-skeleton" : "")} style={{height: "39px"}}>
            {tabs.map((tab) => (
                <ButtonGroup key={tab.id}>
                    <Tooltip content={
                        tab.markers?.length > 0 ? tab.markers?.map((m) => {
                            return `${m.message} (Here: ${m.startLineNumber}:${m.startColumn})\t`
                        }) : tab.id
                    } placement={"bottom"}
                             className={styles["file-tab-tooltip"]} compact={true} hoverOpenDelay={500}>
                        <Button icon={tab.icon} small={!tab.active}
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
                    <Button icon={"cross"} small={true}
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
    )
}
FileTabs.propTypes = {
    closeTab: PropTypes.func
}

export default FileTabs
