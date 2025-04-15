import {Select} from "@blueprintjs/select";
import {Alert, Button, Card, Checkbox, Dialog, Divider, FormGroup, MenuItem} from "@blueprintjs/core";
import React, {useEffect, useRef, useState} from "react";

import {formatDistanceToNow} from 'date-fns';
import virtualFS from "./utils/VirtualFS";
import {IconNames} from "@blueprintjs/icons";
import * as styles from "./EditorPage.module.css";

import build from "./utils/build";
import PropTypes from "prop-types";

import classnames from "classnames";
import {AppToaster} from "../AppToaster.jsx";

const CodeDeployActions = ({setSelectedTabId}) => {
    const [version, setVersion] = useState(virtualFS.fs.version())
    const [newVersion, setNewVersion] = useState(virtualFS.fs.version())
    const [versions, setVersions] = useState(virtualFS.fs.list())
    const [isOpenSwitch, setIsOpenSwitch] = useState(false)
    const [isLoadingSwitch, setIsLoadingSwitch] = useState(false)
    const [versionsDate, setVersionsDate] = useState(Date.now())
    const [prettyVersionDate, setPrettyVersionDate] = useState("")
    const [buildInProgress, setBuildInProgress] = useState(false)
    const [deployInProgress, setDeployInProgress] = useState(false)
    const [saveAndCloseInProgress, setSaveAndCloseInProgress] = useState(false)
    const [treeLoading, setTreeLoading] = useState(virtualFS.fs.getLoading())
    const [rootCertificates, setRootCertificates] = useState([])
    const [onRootCertificateSelected, setOnRootCertificateSelected] = useState(null)
    const [showRootCertificateDialog, setShowRootCertificateDialog] = useState(false)
    const [rememberedRootCertificate, setRememberedRootCertificate] = useState(null);

    const rememberChoiceRef = useRef(false);
    const versionText = (name, date, prev, pretty = false) => {
        if (!name) return
        if (!date) return
        return (
            <div style={{textAlign: "center"}}>
                <span style={{color: "aquamarine"}}>{name}</span>
                {prev && (
                    <div>
                        <span className={"bp5-text-muted bp5-text-small"}>
                            from <span style={{color: "aquamarine", textDecoration: "underline"}}>{prev}</span>
                        </span>
                    </div>
                )}
                <Divider/>
                <span
                    className={"bp5-text-muted"}>
                    {"(" + (pretty ? date : formatDistanceToNow(new Date(date), { addSuffix: true })) + ")"}
                </span>
            </div>
        )
    }

    useEffect(() => {
        const interval = setInterval(() => {
            setPrettyVersionDate(formatDistanceToNow(new Date(versionsDate), {addSuffix: true}))
        }, 20000);

        return () => {
            clearInterval(interval); // Clean up the interval when the component unmounts
        };
    }, [versionsDate]);

    const saveAll = () => {
        const newVersion = virtualFS.fs.create(
            version.version,
            virtualFS.tabs.get().filter((t) => t.id !== "Untitled").map((t) => {
                return {
                    id: t.id,
                    active: t.active
                }
            })
        )
        handleSwitchFsVersion(newVersion)
    }

    const setFsVersion = (ver) => {
        if (ver.version === version.version) return
        setIsOpenSwitch(true)
        setNewVersion(ver)
    }

    const handleConfirmSwitch = () => {
        setIsLoadingSwitch(true)
        handleSwitchFsVersion(newVersion)
        setIsLoadingSwitch(false)
        setIsOpenSwitch(false)
    }

    const handleSwitchFsVersion = (ver) => {
        const data = virtualFS.fs.set(ver.version)
        if (data.tabs.length > 0) {
            virtualFS.tabs.addMultiple(data.tabs)
        }
        setVersion(ver)
        setVersionsDate(ver.date)
        setPrettyVersionDate(formatDistanceToNow(new Date(ver.date), {addSuffix: true}))
    }

    const triggerBuild = async () => {
        setBuildInProgress(true)
        setSelectedTabId("output")
        await build()
        setBuildInProgress(false)
    }

    const selectRootCert = async () => {
        if (rememberedRootCertificate) {
            return rememberedRootCertificate;
        }

        return new Promise((resolve) => {
            setOnRootCertificateSelected(() => label => {
                if (rememberChoiceRef.current) {
                    setRememberedRootCertificate(label);
                }
                resolve(label);
                setOnRootCertificateSelected(null); // clean up
            });

            setShowRootCertificateDialog(true);
        });
    }

    const triggerDeploy = async () => {
        setDeployInProgress(true)
        const name = virtualFS.treeObject[0].label
        try {
            await triggerBuild()
        } catch (e) {
            setDeployInProgress(false)
            return
        } finally {
            setDeployInProgress(false)
        }

        const rootCerts = await window.electron.settings.certificates.getRoot()
        setRootCertificates(rootCerts)
        if (rootCerts.length === 0) {
            (await AppToaster).show({message: `No root certificate found. Please add one.`, intent: "danger"});
            return
        }

        let selectedLabel = rootCerts[0].label;

        if (rootCerts.length > 1) {
            selectedLabel = await selectRootCert();
        }
        const result = await window.electron.plugin.deployToMainFromEditor({
            name: name,
            sandbox:  virtualFS.sandboxName,
            entrypoint: virtualFS.build.getEntrypoint(),
            metadata: virtualFS.build.getMetadata(),
            content: virtualFS.build.getContent(),
            rootCert: selectedLabel
        })
        if (!result.success) {
            (await AppToaster).show({message: `${result.error}`, intent: "danger"});
        }
        setDeployInProgress(false)
    }

    const triggerSaveAndClose = async () => {
        setSaveAndCloseInProgress(true)
        const name = virtualFS.treeObject[0].label
        await window.electron.plugin.saveAndCloseFromEditor({
            name: name,
            sandbox:  virtualFS.sandboxName,
            entrypoint: virtualFS.build.getEntrypoint(),
            metadata: virtualFS.build.getMetadata(),
            content: virtualFS.build.getContent()
        })
    }

    useEffect(() => {
        if (versions) {
            for (const ver of versions) {
                if (ver.current) {
                    setVersion(ver)
                    setVersionsDate(ver.date)
                    setPrettyVersionDate(formatDistanceToNow(new Date(ver.date), {addSuffix: true}))
                    break
                }
            }
        }
    }, [versions]);

    useEffect(() => {
        const unsubscribe = virtualFS.notifications.subscribe("treeVersionsUpdate", setVersions)
        const unsubscribeLoading = virtualFS.notifications.subscribe("treeLoading", setTreeLoading);

        return () => {
            unsubscribe()
            unsubscribeLoading()
        }
    }, []);
    return (
        <>
            <FormGroup
                label={"Snapshots"}
                fill={true}
                className={classnames(treeLoading ? "bp5-skeleton" : "")}
            >
                <Select
                    id={"plugin-template"}
                    items={versions}
                    itemRenderer={
                        (item,
                         {handleClick, handleFocus, modifiers}
                        ) => {
                            return (<MenuItem
                                active={item.current === version.current}
                                disabled={modifiers.disabled}
                                key={item?.version}
                                onClick={handleClick}
                                onFocus={handleFocus}
                                roleStructure="listoption"
                                text={versionText(item.version, item.date, item.prev)}
                                className={item.current === version.current ? "selected-item" : ""}
                            />)
                        }
                    }
                    popoverProps={
                        {
                            minimal: true,
                            matchTargetWidth: true,
                            usePortal: false,
                            position: "top",
                            popoverClassName: styles["versions-scrollable-dropdown"],
                            onOpened: () => {
                                setTimeout(() => {
                                    const selectedItem = document.getElementsByClassName("selected-item");
                                    if (selectedItem && selectedItem.length > 0) {
                                        selectedItem[0].scrollIntoView({ block: "nearest", behavior: "smooth" });
                                    }
                                }, 0);
                            }
                        }
                    }
                    onItemSelect={setFsVersion}
                    filterable={false}
                    fill={true}
                >
                    <Button fill={true} text={versionText(version?.version, prettyVersionDate, version?.prev, true)}
                            rightIcon="double-caret-vertical"/>
                </Select>
            </FormGroup>
            <FormGroup
                label="Actions"
                fill={true}
                className={classnames(treeLoading ? "bp5-skeleton" : "")}
            >
                <Button fill={true} text="Live UI editor" intent="warning" size="large" icon="style" endIcon="share"
                        onClick={() => window.electron.system.openLiveUiWindow({})}/>
                <Divider/>
                <Button fill={true} text="1. Create snapshot" endIcon="saved" onClick={() => saveAll()}/>
                <Divider/>
                <Button fill={true} text="2. Compile" intent="primary" endIcon="build" loading={buildInProgress}
                        onClick={async () => await triggerBuild()}/>
                <Divider/>
                <Button fill={true} text="3. Deploy" intent="success" endIcon="share" loading={deployInProgress}
                        onClick={async () => await triggerDeploy()}/>
                <Divider/>
                <Button fill={true} text="4. Save & Close" endIcon="cross" loading={saveAndCloseInProgress}
                        onClick={async () => await triggerSaveAndClose()}/>
            </FormGroup>
            <Alert
                cancelButtonText="Cancel"
                canEscapeKeyCancel={true}
                canOutsideClickCancel={true}
                confirmButtonText="Switch"
                icon={IconNames.SWITCH}
                intent={"warning"}
                isOpen={isOpenSwitch}
                loading={isLoadingSwitch}
                onCancel={() => setIsOpenSwitch(false)}
                onConfirm={handleConfirmSwitch}
                className={styles["alert-delete"]}
            >
                <p style={{color: "white"}}>
                    Make sure to <b>create snapshot</b> before switching between versions. Unsaved changes will be discard. Proceed?
                </p>
            </Alert>
            <Dialog
                isOpen={showRootCertificateDialog}
                onClose={() => setShowRootCertificateDialog(false)}
                title="Select Root Certificate"
            >
                <div className="bp5-dialog-body">
                    {rootCertificates.map((cert) => (
                        <Card key={cert.label} style={{ marginBottom: "10px" }}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                <div>
                                    <div style={{ fontWeight: 600 }}>{cert.label}</div>
                                    <div style={{ fontSize: "12px", color: "#5C7080" }}>{cert.identity}</div>
                                </div>
                                <Button
                                    intent="primary"
                                    text="Use"
                                    onClick={() => {
                                        setShowRootCertificateDialog(false);
                                        if (rememberChoiceRef.current) {
                                            setRememberedRootCertificate(cert.label);
                                        }
                                        if (onRootCertificateSelected) {
                                            onRootCertificateSelected(cert.label);
                                            setOnRootCertificateSelected(null);
                                        }
                                    }}
                                />
                            </div>
                        </Card>
                    ))}
                    <div style={{ marginTop: "12px" }}>
                        <Checkbox
                            defaultChecked={false}
                            onChange={(e) => {
                                rememberChoiceRef.current = e.currentTarget.checked;
                            }}
                            label="Remember this selection for this session"
                        />
                    </div>
                </div>
            </Dialog>
        </>
    )
}
CodeDeployActions.propTypes = {
    setSelectedTabId: PropTypes.func.isRequired
}

export default CodeDeployActions;