import * as styles from "../css/SettingsDialog.module.css";
import {
    Dialog,
    Icon,
    Tab,
    Tabs
} from "@blueprintjs/core";
import classNames from "classnames";
import React, {useState} from "react";

import PropTypes from "prop-types";
import {GeneralPanel} from "./panels/GeneralPanel.jsx";
import {CertificatePanel} from "./panels/CertificatePanel.jsx";
import AIAssistantsPanel from "./panels/AIAssistantsPanel";

export const SettingsDialog = ({showSettingsDialog, setShowSettingsDialog}) => {
    const [activeTab, setActiveTab] = useState(localStorage.getItem("activeSettingsTab") || "general");
    return (
        <Dialog
            autoFocus={true}
            canEscapeKeyClose={true}
            canOutsideClickClose={true}
            isOpen={showSettingsDialog}
            isCloseButtonShown={true}
            onClose={() => setShowSettingsDialog(false)}
            className={styles["settings"]}
            title={<><Icon icon={"settings"} intent={"primary"} style={{paddingLeft: "3px"}} size={20}/><span
                className={"bp6-heading"}
                style={{fontSize: "1.2rem"}}>Settings</span></>}
            style={{
                minWidth: 900,
                paddingBottom: 0,
                height: 620
            }}
        >
            <Tabs
                vertical={true}
                animate={true}
                id={"settings-tabs"}
                renderActiveTabPanelOnly={true}
                selectedTabId={activeTab}
                onChange={(id) => {
                    setActiveTab(id);
                    localStorage.setItem("activeSettingsTab", id);
                }}
            >
                <Tab id={"general"}
                     title={
                         <div style={{verticalAlign: "center", width: "180px"}}
                              className={"bp6-text-overflow-ellipsis"}>
                             <Icon icon={"cog"} intent={"primary"}/>
                             <span style={{
                                 marginLeft: "5px",
                                 fontSize: "0.8rem",
                                 lineHeight: "10px",
                                 textOverflow: "ellipsis"
                             }}
                                   className={classNames("bp6-text-muted")}>General</span>
                         </div>
                     }
                     style={{
                         borderBottom: "solid 1px #d4d5d7",
                         borderTop: "solid 1px #d4d5d7",
                     }}
                     panelClassName={styles["panel"]}
                     panel={
                         <GeneralPanel/>
                     }/>
                <Tab id={"certificates"}
                     title={
                         <div style={{verticalAlign: "center", width: "180px"}}
                              className={"bp6-text-overflow-ellipsis"}>
                             <Icon icon={"id-number"} intent={"primary"}/>
                             <span style={{
                                 marginLeft: "5px",
                                 fontSize: "0.8rem",
                                 lineHeight: "10px",
                                 textOverflow: "ellipsis"
                             }}
                                   className={classNames("bp6-text-muted")}>Certificates</span>
                         </div>
                     }
                     style={{
                         borderBottom: "solid 1px #d4d5d7",
                     }}
                     panelClassName={styles["panel"]}
                     panel={
                         <CertificatePanel/>
                     }/>
                <Tab id={"ai"}
                     title={
                         <div style={{verticalAlign: "center", width: "180px"}}
                              className={"bp6-text-overflow-ellipsis"}>
                             <Icon icon={"manual"} intent={"primary"}/>
                             <span style={{
                                 marginLeft: "5px",
                                 fontSize: "0.8rem",
                                 lineHeight: "10px",
                                 textOverflow: "ellipsis"
                             }}
                                   className={classNames("bp6-text-muted")}>AI Assistants</span>
                         </div>
                     }
                     style={{
                         borderBottom: "solid 1px #d4d5d7",
                     }}
                     panelClassName={styles["panel"]}
                     panel={
                         <AIAssistantsPanel/>
                     }/>
            </Tabs>
        </Dialog>
    )
}
SettingsDialog.propTypes = {
    showSettingsDialog: PropTypes.bool,
    setShowSettingsDialog: PropTypes.func,
}
