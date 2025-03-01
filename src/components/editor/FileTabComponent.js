import {Button, ButtonGroup, Tooltip} from "@blueprintjs/core";
import PropTypes from 'prop-types';
import virtualFS from "./utils/VirtualFS";
import styles from './EditorPage.module.css'
import {useEffect, useState} from "react";

const FileTabs = ({closeTab}) => {
    const [tabs, setTabs] = useState([])
    useEffect(() => {
        const unsubscribe = virtualFS.notifications.subscribe("fileTabs", setTabs);

        return () => {
            unsubscribe()
        }
    }, [])
    return (
        <div className={styles["file-tabs"]}>
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
