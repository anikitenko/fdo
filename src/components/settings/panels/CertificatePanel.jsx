import React, {useEffect, useState} from "react";
import {differenceInDays, formatDistanceToNow} from "date-fns";
import * as styles from "../../css/SettingsDialog.module.css";
import {Button, Card, CardList, EditableText, H2, Icon, NonIdealState} from "@blueprintjs/core";
import {AppToaster} from "../../AppToaster";
import {CertificateValidComponent} from "../../editor/utils/CertificateValidComponent";

export const CertificatePanel = () => {
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