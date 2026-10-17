import * as styles from "../css/SettingsDialog.module.css";
import {
    Dialog,
    Icon,
    Tab,
    Tabs
} from "@blueprintjs/core";
import classNames from "classnames";
import React, {useEffect, useState} from "react";

import PropTypes from "prop-types";
import {GeneralPanel} from "./panels/GeneralPanel.jsx";
import {CertificatePanel} from "./panels/CertificatePanel.jsx";
import AIAssistantsPanel from "./panels/AIAssistantsPanel";
import AICodingInstructionsPanel from "./panels/AICodingInstructionsPanel";
import AIExtensionsPanel from './panels/AIExtensionsPanel';
import SharedProcessScopesPanel from "./panels/SharedProcessScopesPanel.jsx";
import SharedFilesystemScopesPanel from "./panels/SharedFilesystemScopesPanel.jsx";
import GitOpsPanel from './panels/GitOpsPanel';
import ObservabilityPanel from './panels/ObservabilityPanel';

export const SettingsDialog = ({showSettingsDialog, setShowSettingsDialog, navigationRequest}) => {
    const [activeTab, setActiveTab] = useState(localStorage.getItem("activeSettingsTab") || "general");
    useEffect(() => {
        if (navigationRequest?.tab) {setActiveTab(navigationRequest.tab); localStorage.setItem('activeSettingsTab', navigationRequest.tab);}
    }, [navigationRequest?.requestId]);
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
                    localStorage.setItem("activeSettingsTab", String(id));
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
                <Tab id="gitops" title={<div style={{width: '180px'}}><Icon icon="git-repo" intent="primary"/><span className="bp6-text-muted" style={{marginLeft: 5, fontSize: '0.8rem'}}>GitOps</span></div>}
                     panelClassName={styles['panel']} panel={<GitOpsPanel focusRepositoryId={navigationRequest?.repositoryId}/>}/>
                <Tab id="observability" title={<div style={{width: '180px'}}><Icon icon="timeline-line-chart" intent="primary"/><span className="bp6-text-muted" style={{marginLeft: 5, fontSize: '0.8rem'}}>Observability</span></div>}
                     panelClassName={styles['panel']} panel={<ObservabilityPanel/>}/>
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
                <Tab id="ai-extensions" title={<div style={{width: '180px'}}><Icon icon="applications" intent="primary"/><span className="bp6-text-muted" style={{marginLeft: 5, fontSize: '0.8rem'}}>AI Extensions</span></div>}
                     panelClassName={styles['panel']} panel={<AIExtensionsPanel onOpenAssistants={() => {setActiveTab('ai'); localStorage.setItem('activeSettingsTab', 'ai');}}/>}/>
                <Tab id={"ai-coding-instructions"}
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
                                   className={classNames("bp6-text-muted")}>Coding Instructions</span>
                         </div>
                     }
                     style={{
                         borderBottom: "solid 1px #d4d5d7",
                     }}
                     panelClassName={styles["panel"]}
                     panel={
                         <AICodingInstructionsPanel/>
                     }/>
                <Tab id={"shared-process-scopes"}
                     title={
                         <div style={{verticalAlign: "center", width: "180px"}}
                              className={"bp6-text-overflow-ellipsis"}>
                             <Icon icon={"flows"} intent={"primary"}/>
                             <span style={{
                                 marginLeft: "5px",
                                 fontSize: "0.8rem",
                                 lineHeight: "10px",
                                 textOverflow: "ellipsis"
                             }}
                                   className={classNames("bp6-text-muted")}>Shared Process Scopes</span>
                         </div>
                     }
                     style={{
                         borderBottom: "solid 1px #d4d5d7",
                     }}
                     panelClassName={styles["panel"]}
                     panel={
                         <SharedProcessScopesPanel/>
                     }/>
                <Tab id={"shared-filesystem-scopes"}
                     title={
                         <div style={{verticalAlign: "center", width: "180px"}}
                              className={"bp6-text-overflow-ellipsis"}>
                             <Icon icon={"folder-open"} intent={"primary"}/>
                             <span style={{
                                 marginLeft: "5px",
                                 fontSize: "0.8rem",
                                 lineHeight: "10px",
                                 textOverflow: "ellipsis"
                             }}
                                   className={classNames("bp6-text-muted")}>Shared FS Scopes</span>
                         </div>
                     }
                     style={{
                         borderBottom: "solid 1px #d4d5d7",
                     }}
                     panelClassName={styles["panel"]}
                     panel={
                         <SharedFilesystemScopesPanel/>
                     }/>
            </Tabs>
        </Dialog>
    )
}
SettingsDialog.propTypes = {
    showSettingsDialog: PropTypes.bool,
    setShowSettingsDialog: PropTypes.func,
}
