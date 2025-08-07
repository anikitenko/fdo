import * as styles from "./css/SettingsDialog.module.css";
import {
    Button,
    Card,
    CardList,
    Dialog,
    EditableText,
    H2,
    Icon,
    NonIdealState,
    Switch,
    Tab,
    Tabs
} from "@blueprintjs/core";
import classNames from "classnames";
import React, {useEffect, useState} from "react";

import PropTypes from "prop-types";
import {differenceInDays, formatDistanceToNow} from 'date-fns';
import {AppToaster} from "./AppToaster.jsx";
import {CertificateValidComponent} from "./editor/utils/CertificateValidComponent";

export const SettingsDialog = ({showSettingsDialog, setShowSettingsDialog}) => {
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
            </Tabs>
        </Dialog>
    )
}
SettingsDialog.propTypes = {
    showSettingsDialog: PropTypes.bool,
    setShowSettingsDialog: PropTypes.func,
}

const GeneralPanel = () => {
    const [fdoInPath, setFdoInPath] = useState(false);
    useEffect(() => {
        window.electron.system.isFdoInPath().then((result) => {
            if (result.success) {
                setFdoInPath(true)
            } else {
                setFdoInPath(false)
            }
        })
    }, []);
    return (
        <Card className={styles["card-panel"]}>
            <Switch size="medium" style={{marginTop: "15px"}}
                    labelElement={<strong>{fdoInPath ? "Remove" : "Install"} 'fdo'
                        command {fdoInPath ? "from" : "in"} PATH</strong>}
                    innerLabelChecked="installed :)" innerLabel="not installed :("
                    checked={fdoInPath}
                    onChange={() => {
                        if (fdoInPath) {
                            window.electron.system.removeFdoFromPath().then((result) => {
                                if (result.success) {
                                    setFdoInPath(false)
                                } else {
                                    if (result.error === "skip") {
                                        return
                                    }
                                    (AppToaster).show({message: `${result.error}`, intent: "danger"});
                                }
                            })
                        } else {
                            window.electron.system.addFdoInPath().then((result) => {
                                if (result.success) {
                                    setFdoInPath(true)
                                } else {
                                    if (result.error === "skip") {
                                        return
                                    }
                                    (AppToaster).show({message: `${result.error}`, intent: "danger"});
                                }
                            })
                        }
                    }}
            />
        </Card>
    )
}

const CertificatePanel = () => {
    const [rootCertificates, setRootCertificates] = useState([]);
    const [generateRootCertProgress, setGenerateRootCertProgress] = useState(false)
    const [importRootCertProgress, setImportRootCertProgress] = useState(false)
    const [exportRootCertProgress, setExportRootCertProgress] = useState(false)
    const [deleteRootCertProgress, setDeleteRootCertProgress] = useState(false)
    const [renewRootCertProgress, setRenewRootCertProgress] = useState(false)
    const updateCertificates = () => {
        window.electron.settings.certificates.getRoot().then((certificates) => {
            setRootCertificates(certificates)
        })
    }
    const handleRootCertLabelChange = React.useCallback((id, newName) => {
        window.electron.settings.certificates.rename(id, newName).then(() => {
            updateCertificates()
        })
    }, []);

    const showColoredLastUsed = (lastUsed) => {
        const lastUsedDate = new Date(lastUsed);
        const daysAgo = differenceInDays(new Date(), lastUsedDate);

        const usageClass = daysAgo < 7 ? styles["text-green"] : styles["text-red"];

        return (
            <span className={`bp6-text-muted ${usageClass}`}>
                Last used {formatDistanceToNow(lastUsedDate, {addSuffix: true})}
            </span>
        )
    }

    useEffect(() => {
        updateCertificates()
    }, []);
    return (
        <Card className={styles["card-panel"]}>
            <div className={styles["card-setting-header"]}>
                <H2 style={{margin: 0}}>Root certificates</H2>
                <Button intent={"success"} text="New root certificate" loading={generateRootCertProgress}
                        style={{marginLeft: "auto", borderRadius: "6px"}} onClick={() => {
                    setGenerateRootCertProgress(true)
                    window.electron.settings.certificates.create().then(() => {
                        updateCertificates()
                        setGenerateRootCertProgress(false)
                    })
                }}/>
                <Button intent={"primary"} text="Import" icon={"import"} loading={importRootCertProgress}
                        style={{marginLeft: "5px", borderRadius: "6px"}} onClick={async () => {
                    setImportRootCertProgress(true)
                    const file = await window.electron.system.openFileDialog({
                        title: 'Select root certificate',
                        buttonLabel: 'Upload',
                        properties: ['openFile'],
                        filters: [
                            {name: 'Certificates', extensions: ['cert', 'crt', 'pem', 'ca']},
                        ],
                    })
                    if (file) {
                        window.electron.settings.certificates.import(file).then(async (response) => {
                            if (response.success) {
                                updateCertificates()
                            } else {
                                (AppToaster).show({message: `${response.error}`, intent: "danger"});
                            }
                        })
                    }
                    setImportRootCertProgress(false)
                }}/>
            </div>
            <p>
                Root certificates are used to verify the authenticity of plugins.
                They form the foundation of trust in your system. Only trusted root certificates should be used,
                and you can manage them here.
            </p>
            {rootCertificates?.length > 0 ? (
                <CardList>
                    {rootCertificates.map((cert) => (
                        <Card key={cert.id} style={{padding: "12px 16px"}}>
                            <div
                                style={{
                                    display: "flex",
                                    justifyContent: "space-between",
                                    alignItems: "center",
                                    width: "100%",
                                    gap: "5px"
                                }}
                            >
                                <div style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: "12px",
                                    flex: "1",
                                    minWidth: "0",
                                    width: "0"
                                }}>
                                    <Icon icon="id-number" size={32}/>
                                    <div className={"bp6-text-overflow-ellipsis"}>
                                        <div style={{padding: "3px"}}>
                                            {cert.label === "root" ? (
                                                <strong style={{color: "#2d72d2"}}>{cert.label}</strong>
                                            ) : (
                                                <strong><EditableText intent="primary" selectAllOnFocus={true}
                                                                      placeholder={cert.label} defaultValue={cert.label}
                                                                      onConfirm={(value) => {
                                                                          handleRootCertLabelChange(cert.id, value)
                                                                      }}/></strong>
                                            )}
                                        </div>
                                        {cert.imported !== true && (
                                            <div><strong>{cert.identity}</strong></div>
                                        )}
                                        <div>
                                            <code className={"bp6-monospace-text"} style={{
                                                overflowWrap: "anywhere",
                                                fontSize: "12px"
                                            }}>{cert.id}</code>
                                        </div>
                                        <CertificateValidComponent cert={cert}/>
                                        <div>
                                <span className={"bp6-text-muted"}>
                                    Added {formatDistanceToNow(new Date(cert.createdAt), {addSuffix: true})}
                                </span>
                                        </div>
                                        <div>
                                            {showColoredLastUsed(cert.lastUsedAt)}
                                        </div>
                                    </div>
                                </div>
                                <div style={{display: "flex", flexDirection: "column", gap: "6px"}}>
                                    {cert.imported !== true && (
                                        <Button size={"small"} variant={"outlined"} intent="warning"
                                                loading={renewRootCertProgress}
                                                style={{borderRadius: "6px"}} onClick={() => {
                                            setRenewRootCertProgress(true)
                                            window.electron.settings.certificates.renew(cert.label).then(() => {
                                                updateCertificates()
                                            })
                                            setRenewRootCertProgress(false)
                                        }}>
                                            Regenerate
                                        </Button>
                                    )}
                                    {cert.label !== "root" && (
                                        <>
                                            {cert.imported !== true && (
                                                <Button size={"small"} variant={"outlined"} intent="primary"
                                                        loading={exportRootCertProgress}
                                                        style={{borderRadius: "6px"}} onClick={() => {
                                                    window.electron.settings.certificates.export(cert.id).then((data) => {
                                                        setExportRootCertProgress(true)
                                                        if (data) {
                                                            const blob = new Blob([data], {type: 'application/x-pem-file'});
                                                            const url = window.URL.createObjectURL(blob);
                                                            const a = document.createElement('a');
                                                            a.href = url;
                                                            a.download = `${cert.label}.crt`;
                                                            document.body.appendChild(a);
                                                            a.click();
                                                            window.URL.revokeObjectURL(url);
                                                            document.body.removeChild(a);
                                                        }
                                                        setExportRootCertProgress(false)
                                                    })
                                                }}>
                                                    Export
                                                </Button>
                                            )}
                                            <Button size={"small"} variant={"outlined"} intent="danger"
                                                    loading={deleteRootCertProgress}
                                                    style={{borderRadius: "6px"}} onClick={() => {
                                                setDeleteRootCertProgress(true)
                                                window.electron.settings.certificates.delete(cert.id).then(() => {
                                                    updateCertificates()
                                                })
                                                setDeleteRootCertProgress(false)
                                            }}>
                                                Delete
                                            </Button>
                                        </>
                                    )}
                                </div>
                            </div>
                        </Card>
                    ))}
                </CardList>
            ) : (
                <div style={{padding: "20px"}}>
                    <NonIdealState
                        icon="shield"
                        title="No certificates found"
                        description="Root certificates will appear here once they are created."
                        layout="vertical"
                    />
                </div>
            )}
            <div className={styles["card-setting-header"]}>
                <H2 style={{margin: 0}}>Registry certificates</H2>
            </div>
            <p>
                Registry certificates are used to verify the identity and integrity of plugin registries.
                Only registries signed with trusted certificates will be accepted. These certificates
                help ensure that plugins come from secure and authenticated sources.
            </p>
            <div className={styles["card-setting-header"]}>
                <H2 style={{margin: 0}}>Organization certificates</H2>
            </div>
            <p>
                Organization certificates are issued by a trusted Root CA to individual developers or teams.
                These certificates are used to sign plugins and establish trust within your organization.
            </p>
        </Card>
    )
}