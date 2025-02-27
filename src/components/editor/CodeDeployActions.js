import {Select} from "@blueprintjs/select";
import {Alert, Button, Divider, FormGroup, MenuItem} from "@blueprintjs/core";
import React, {useEffect, useState} from "react";

import {formatDistanceToNow} from 'date-fns';
import virtualFS from "./utils/VirtualFS";
import {IconNames} from "@blueprintjs/icons";
import styles from "./EditorPage.module.css";

const CodeDeployActions = () => {
    const [version, setVersion] = useState(virtualFS.fs.version())
    const [newVersion, setNewVersion] = useState(virtualFS.fs.version())
    const [versions, setVersions] = useState(virtualFS.fs.list())
    const [isOpenSwitch, setIsOpenSwitch] = useState(false)
    const [isLoadingSwitch, setIsLoadingSwitch] = useState(false)
    const versionText = (name, date, prev) => {
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
                    className={"bp5-text-muted"}>{"(" + formatDistanceToNow(new Date(date), {addSuffix: true}) + ")"}</span>
            </div>
        )
    }

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
    }

    useEffect(() => {
        if (versions) {
            for (const ver of versions) {
                if (ver.current) {
                    setVersion(ver)
                    break
                }
            }
        }
    }, [versions]);

    useEffect(() => {
        const unsubscribe = virtualFS.notifications.subscribe("treeVersionsUpdate", setVersions);

        return () => {
            unsubscribe()
        }
    }, []);
    return (
        <>
            <FormGroup
                label="Version"
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
                                        console.log(selectedItem[0])
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
                    <Button fill={true} text={versionText(version?.version, version?.date, version?.prev)}
                            rightIcon="double-caret-vertical"/>
                </Select>
            </FormGroup>
            <FormGroup
                label="Actions"
                fill={true}
            >
                <Button fill={true} text="Save All" intent="primary" rightIcon="saved" onClick={() => saveAll()}/>
            </FormGroup>
            <Button fill={true} text="Deploy" intent="success" rightIcon="share"/>
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

export default CodeDeployActions;