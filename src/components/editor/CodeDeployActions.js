import {Select} from "@blueprintjs/select";
import {Alert, Button, Divider, FormGroup, MenuItem} from "@blueprintjs/core";
import React, {useEffect, useState} from "react";

import {formatDistanceToNow} from 'date-fns';
import virtualFS from "./utils/VirtualFS";
import {IconNames} from "@blueprintjs/icons";
import * as styles from "./EditorPage.module.css";

import build from "./utils/build";
import {PropTypes} from "prop-types";

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
        }, 20000); // Update every second

        return () => {
            clearInterval(interval); // Clean up the interval when the component unmounts
        };
    }, [versionsDate]);

    const saveAll = () => {
        const newVersion = virtualFS.fs.create(version.version, virtualFS.tabs.get().filter((t) => t.id !== "Untitled"))
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

    const triggerDeploy = async () => {
        setDeployInProgress(true)
        const name = virtualFS.treeObject[0].label
        if (!virtualFS.build.getMetadata()) {
            await triggerBuild()
        }
        await window.electron.deployToMainFromEditor({
            name: name,
            sandbox:  virtualFS.sandboxName,
            entrypoint: virtualFS.build.getEntrypoint(),
            metadata: virtualFS.build.getMetadata(),
            content: virtualFS.build.getContent()
        })
        setDeployInProgress(false)
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

        return () => {
            unsubscribe()
        }
    }, []);
    return (
        <>
            <FormGroup
                label={"Snapshots"}
                fill={true}
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
            >
                <Button fill={true} text="1. Create snapshot" rightIcon="saved" onClick={() => saveAll()}/>
                <Divider/>
                <Button fill={true} text="2. Compile" intent="primary" rightIcon="build" loading={buildInProgress}
                        onClick={async () => await triggerBuild()}/>
                <Divider/>
                <Button fill={true} text="3. Deploy" intent="success" rightIcon="share" loading={deployInProgress}
                        onClick={async () => await triggerDeploy()}/>
                <Divider/>
                <Button fill={true} text="4. Save & Close" rightIcon="cross"/>
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
                    Make sure to <b>Save All</b> before switching between versions. Unsaved changes will be discard. Proceed?
                </p>
            </Alert>
        </>
    )
}
CodeDeployActions.propTypes = {
    setSelectedTabId: PropTypes.func.isRequired
}

export default CodeDeployActions;