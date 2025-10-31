import {Select} from "@blueprintjs/select";
import {Alert, Button, Divider, FormGroup, MenuItem} from "@blueprintjs/core";
import React, {useEffect, useRef, useState} from "react";

import {formatDistanceToNow} from 'date-fns';
import virtualFS from "./utils/VirtualFS";
import {IconNames} from "@blueprintjs/icons";
import * as styles from "./EditorPage.module.css";

import build from "./utils/build";
import PropTypes from "prop-types";

import classnames from "classnames";
import {AppToaster} from "../AppToaster.jsx";
import {RootCertificateSelectionComponent, selectRootCert} from "./utils/RootCertificateSelectionComponent";

const CodeDeployActions = ({setSelectedTabId, pluginDirectory}) => {
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
                        <span className={"bp6-text-muted bp6-text-small"}>
                            from <span style={{color: "aquamarine", textDecoration: "underline"}}>{prev}</span>
                        </span>
                    </div>
                )}
                <Divider/>
                <span
                    className={"bp6-text-muted"}>
                    {"(" + (pretty ? date : formatDistanceToNow(new Date(date), {addSuffix: true})) + ")"}
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

    const handleRootCertificateSelection = async () => {
        const rootCerts = await window.electron.settings.certificates.getRoot()
        setRootCertificates(rootCerts)
        if (rootCerts.length === 0) {
            (AppToaster).show({message: `No root certificate found. Please add one.`, intent: "danger"});
            return null
        }

        let selectedLabel = rootCerts[0].label;

        if (rootCerts.length > 1) {
            selectedLabel = await selectRootCert(setShowRootCertificateDialog, rememberedRootCertificate, rememberChoiceRef, setRememberedRootCertificate, setOnRootCertificateSelected);
        }

        if (!selectedLabel) {
            setDeployInProgress(false)
            return null
        }

        return selectedLabel
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

    const triggerDeploy = async () => {
        setDeployInProgress(true)
        const name = virtualFS.treeObject[0].label
        try {
            await triggerBuild()
        } catch (e) {
            setDeployInProgress(false)
            (await AppToaster).show({message: `Build failed: ${e.message}`, intent: "danger"});
            return
        }

        let selectedLabel = await handleRootCertificateSelection()

        if (!selectedLabel) {
            setDeployInProgress(false)
            return
        }

        const metadata = await virtualFS.build.getMetadata()
        if (!metadata) {
            (await AppToaster).show({message: `No metadata found.`, intent: "danger"});
            return
        }

        const result = await window.electron.plugin.deployToMainFromEditor({
            name,
            sandbox: virtualFS.sandboxName,
            entrypoint: virtualFS.build.getEntrypoint(),
            metadata,
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

        let selectedLabel = await handleRootCertificateSelection()

        if (!selectedLabel) {
            setDeployInProgress(false)
            return
        }

        const content = []
        virtualFS.listModels().forEach((model) => {
            const modelUri = model.uri.toString(true).replace("file://", "")
            if (modelUri.includes("/node_modules/")) {
                return
            }
            content.push({
                path: modelUri,
                content: model.getValue(),
            })
        })

        const metadata = await virtualFS.build.getMetadata()
        if (!metadata) {
            (await AppToaster).show({message: `No metadata found.`, intent: "danger"});
            return
        }

        const result = await window.electron.plugin.saveAndCloseFromEditor({
            name,
            sandbox: virtualFS.sandboxName,
            entrypoint: virtualFS.build.getEntrypoint(),
            metadata,
            dir: pluginDirectory,
            rootCert: selectedLabel,
            content
        })
        if (!result.success) {
            (await AppToaster).show({message: `${result.error}`, intent: "danger"});
        }
        localStorage.removeItem("sandbox_" + name)
        setSaveAndCloseInProgress(false)
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
                className={classnames(treeLoading ? "bp6-skeleton" : "")}
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
                                        selectedItem[0].scrollIntoView({block: "nearest", behavior: "smooth"});
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
                            endIcon="double-caret-vertical"/>
                </Select>
            </FormGroup>
            <FormGroup
                label="Actions"
                fill={true}
                className={classnames(treeLoading ? "bp6-skeleton" : "")}
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
                    Make sure to <b>create snapshot</b> before switching between versions. Unsaved changes will be
                    discarded. Proceed?
                </p>
            </Alert>
            <RootCertificateSelectionComponent
                show={showRootCertificateDialog}
                setShow={setShowRootCertificateDialog}
                rootCertificates={rootCertificates}
                rememberRef={rememberChoiceRef}
                setRememberRootCert={setRememberedRootCertificate}
                onRootSelectedCert={onRootCertificateSelected}
                setOnRootSelectedCert={setOnRootCertificateSelected}
            />
        </>
    )
}
CodeDeployActions.propTypes = {
    setSelectedTabId: PropTypes.func.isRequired,
    pluginDirectory: PropTypes.string.isRequired
}

export default CodeDeployActions;