import RegistryCertificates from './RegistryCertificates';
import OrganizationCertificates from './OrganizationCertificates';
import {operationError} from '../../../utils/desktop/notificationContent';
import React, {useEffect, useState} from "react";
import CertificateDetails from './CertificateDetails';
import {certificateDisplayName} from '../../../utils/system/certificateDisplay';
import * as styles from "../../css/SettingsDialog.module.css";
import {Button, Card, CardList, EditableText, H2, NonIdealState} from "@blueprintjs/core";
import {AppToaster} from "../../AppToaster";

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
        }).catch(error => AppToaster.show({message: operationError('Could not load certificates', error, 'Unlock your OS credential store and reopen this settings page.'), intent: 'danger'}))
    }
    const handleRootCertLabelChange = React.useCallback((id, newName) => {
        window.electron.settings.certificates.rename(id, newName).then(() => {
            updateCertificates()
        }).catch(error => AppToaster.show({message: operationError('Could not rename this certificate', error), intent: 'danger'}))
    }, []);

    useEffect(() => {
        updateCertificates()
    }, []);
    return (
        <Card className={styles["card-panel"]}>
            <div className={`${styles["card-setting-header"]} ${styles.certificateHeader}`}>
                <H2 style={{margin: 0, fontSize: 16}}>Root certificates</H2>
                <Button intent={"success"} text="New root certificate" loading={generateRootCertProgress}
                        style={{borderRadius: "6px"}} onClick={() => {
                    setGenerateRootCertProgress(true)
                    const label = rootCertificates.some(cert => cert.label === 'root')
                        ? `Signing-${(Math.random() + 1).toString(36).substring(2)}` : 'root';
                    window.electron.settings.certificates.create(label).then(() => {
                        updateCertificates()
                    }).catch(error => AppToaster.show({message: operationError('Could not create a signing certificate', error, 'Try again and choose Allow if macOS asks FDO to use the Keychain.'), intent: 'danger'}))
                        .finally(() => setGenerateRootCertProgress(false))
                }}/>
                <Button intent={"primary"} text="Import root certificate" icon={"import"} loading={importRootCertProgress}
                        style={{borderRadius: "6px"}} onClick={async () => {
                    setImportRootCertProgress(true)
                    try {
                        const file = await window.electron.system.openFileDialog({
                            title: 'Select root certificate',
                            buttonLabel: 'Import', properties: ['openFile'],
                            filters: [{name: 'Certificates', extensions: ['cert', 'crt', 'pem', 'ca']}],
                        });
                        if (!file) return;
                        const response = await window.electron.settings.certificates.import(file);
                        if (!response.success) {
                            AppToaster.show({message: operationError('Could not import the selected certificate', new Error(response.error)), intent: 'danger'});
                            return;
                        }
                        if (!response.canceled) {
                            updateCertificates();
                        }
                    } catch (error) {
                        AppToaster.show({message: operationError('Could not import the selected certificate', error), intent: 'danger'});
                    } finally {
                        setImportRootCertProgress(false);
                    }
                }}/>
            </div>
            <p>
                Root certificates are used to verify the authenticity of plugins.
                They form the foundation of trust in your system. Only trusted root certificates should be used,
                and you can manage them here.
            </p>
            <p className="bp6-text-muted">
                FDO uses macOS Keychain to protect private signing keys in your local profile. You may see a macOS
                permission prompt when you create, import, renew, or use a key to sign a plugin. Choose Allow to
                continue; the plugin itself never receives Keychain access. FDO does not request this access at startup
                or for a deployment preview.
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
                                <CertificateDetails cert={cert} label={cert.label === 'root'
                                    ? <strong style={{color: '#2d72d2'}}>{cert.label}</strong>
                                    : <strong><EditableText intent="primary" selectAllOnFocus placeholder={certificateDisplayName(cert.label)}
                                        defaultValue={certificateDisplayName(cert.label)} onConfirm={value => handleRootCertLabelChange(cert.id, value)}/></strong>}/>
                                <div style={{display: "flex", flexDirection: "column", gap: "6px"}}>
                                    {cert.imported !== true && (
                                        <Button size={"small"} variant={"outlined"} intent="warning"
                                                loading={renewRootCertProgress}
                                                style={{borderRadius: "6px"}} onClick={() => {
                                            setRenewRootCertProgress(true)
                                            window.electron.settings.certificates.renew(cert.label).then(() => {
                                                updateCertificates()
                                            }).catch(error => AppToaster.show({message: operationError(`Could not renew certificate “${cert.label}”`, error), intent: 'danger'}))
                                                .finally(() => setRenewRootCertProgress(false))
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
                                                    }).catch(error => AppToaster.show({message: operationError(`Could not export certificate “${cert.label}”`, error), intent: 'danger'}))
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
                                                }).catch(error => AppToaster.show({message: operationError(`Could not remove certificate “${cert.label}”`, error), intent: 'danger'}))
                                                    .finally(() => setDeleteRootCertProgress(false))
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
                <div>
                    <NonIdealState iconSize={24} className={styles["certificate-empty-state"]}
                        icon="shield"
                        title="No certificates found"
                        description="Root certificates will appear here once they are created."
                        layout="horizontal"
                    />
                </div>
            )}
            <RegistryCertificates/>
            <OrganizationCertificates/>
        </Card>
    )
}
