import {useEffect, useState} from "react";
import {Callout, Dialog, DialogBody, Divider, InputGroup} from "@blueprintjs/core";
import {getIconForFile, getIconForFolder} from "vscode-icons-js";
import virtualFS from "./utils/VirtualFS";
import {createVirtualFile} from "./utils/createVirtualFile";
import {packageNewFileContent} from "./utils/packageNewFileContent";
import {getFullPathOfFileFolder} from "./utils/getFullPathOfFileFolder";
import * as styles from './EditorPage.module.css'

const FileDialogComponent = () => {
    const [fileDialogShow, setFileDialogShow] = useState(virtualFS.getFileDialog())
    const [newOverlayValue, setNewOverlayValue] = useState("")
    const [fileType, setFileType] = useState("")
    const [newOverlayValueWithExt, setNewOverlayValueWithExt] = useState("")
    const [newOverlayIcon, setNewOverlayIcon] = useState(null)
    const fileTypes = (filter) => {
        const types = [
            {name: "Typescript file", ext: ".ts"},
            {name: "Typescript TSX file", ext: ".tsx"},
            {name: "Javascript file", ext: ".js"},
            {name: "Javascript JSX file", ext: ".jsx"},
            {name: "Javascript module", ext: ".mjs"},
            {name: "HTML file", ext: ".html"},
            {name: "Stylesheet", ext: ".css"},
            {name: "Markdown file", ext: ".md"},
        ]
        if (!filter) {
            return types
        }
        return types.filter((type) => (
            filter.includes(".*") || filter.includes(type.ext)
            )
        )
    }

    const selectFileType = (e, ext) => {
        const fileOptions = document.getElementsByClassName(styles["new-file-option"])
        let existClass = false;
        for (const element of fileOptions) {
            // Remove the class 'active' if it exists
            if (e.currentTarget.classList.contains(styles['selected'])) {
                existClass = true;
            }
            element.classList.remove(styles['selected'])
        }
        if (!existClass) {
            e.currentTarget.classList.add(styles["selected"])
            setFileType(ext)
        } else {
            setFileType("")
        }
        setNewOverlayValue(newOverlayValue + " ")
        setTimeout(() => {
            setNewOverlayValue(newOverlayValue.trimEnd())
        }, 100)
    }

    const getDialogTitle = () => {
        if (fileDialogShow.data.action === "rename") return "Rename file"
        return fileDialogShow.data.type ? "New folder" : "New file"
    }

    const closeDialog = () => {
        setNewOverlayValue("")
        setFileType("")
        setNewOverlayValueWithExt("")
        virtualFS.closeFileDialog()
    }

    useEffect(() => {
        if (newOverlayValue) {
            let icon = getIconForFile(newOverlayValue + fileType)
            if (fileDialogShow.data.type) {
                icon = getIconForFolder(newOverlayValue)
            } else if (fileDialogShow.data.action === "rename") {
                if (fileDialogShow.data.node.type === "file") {
                    icon = getIconForFile(newOverlayValue + fileType)
                } else {
                    icon = getIconForFolder(newOverlayValue)
                }
            }
            setNewOverlayIcon(
                <img src={"static://assets/icons/vscode/" + icon} width="30" height="30"
                     alt="icon"/>
            )
        }
        setNewOverlayValueWithExt(newOverlayValue + fileType)
    }, [newOverlayValue]);

    useEffect(() => {

        setNewOverlayValue(" ")
        setFileType("")

        setTimeout(() => {
            setNewOverlayValue("")
        }, 100)

        const unsubscribe = virtualFS.notifications.subscribe("fileDialog", setFileDialogShow);

        return () => {
            unsubscribe()
        }
    }, []);
    return (
        <Dialog isOpen={fileDialogShow.show}
                onClose={() => closeDialog()}
                style={{width: "45%"}} className={styles["file-dialog-component"]}
        >
            <DialogBody>
                <div style={{textAlign: "center"}}>
                    <span className={"bp5-heading"} style={{color: "white"}}>
                        {getDialogTitle()}
                    </span>
                </div>
                {fileDialogShow.data.action === "rename" && (
                    <Callout intent={"warning"} style={{color: "white", marginTop: "5px"}}>
                        <b>Warning:</b> Renaming behaves like the 'mv' command on Linux. Renaming to an existing file will overwrite it. Renaming to a directory will silently fail. Moving to another directory will relocate the file.
                    </Callout>
                )}
                <InputGroup
                    leftElement={newOverlayIcon}
                    onChange={(e) => setNewOverlayValue(e.target.value)}
                    value={newOverlayValue}
                    placeholder={fileDialogShow.data.action === "rename" ? "Location/New name" : "Name"}
                    autoFocus={true}
                    onKeyPress={(e) => {
                        if (e.key === "Enter") {
                            let newFile = newOverlayValueWithExt
                            if (fileDialogShow.data.action) {
                                if (fileDialogShow.data.action === "rename") {
                                    if (newFile.split("/")[0] !== "") {
                                        const prefix = getFullPathOfFileFolder(fileDialogShow.data.node.id, fileDialogShow.data.node.type, true)
                                        newFile = prefix+newOverlayValueWithExt
                                    }
                                    virtualFS.rename(fileDialogShow.data.node, newFile)
                                }
                            } else if (fileDialogShow.data.node) {
                                if (newFile.split("/")[0] !== "") {
                                    const prefix = getFullPathOfFileFolder(fileDialogShow.data.node.id, fileDialogShow.data.node.type)
                                    newFile = prefix+newOverlayValueWithExt
                                }
                                if (fileDialogShow.data.type) {
                                    virtualFS.createFolder(newFile)
                                } else {
                                    createVirtualFile(newFile, packageNewFileContent(newFile))
                                    virtualFS.setTreeObjectItemBool(newFile, "isSelected")
                                }
                            } else {
                                if (newFile.split("/")[0] !== "") {
                                    const prefix = getFullPathOfFileFolder("/", "file")
                                    newFile = prefix+newOverlayValueWithExt
                                }
                                createVirtualFile(newFile, packageNewFileContent(newFile))
                                virtualFS.setTreeObjectItemBool(newFile, "isSelected")
                            }
                            closeDialog()
                        }
                    }}
                />
                {fileTypes(fileDialogShow.data?.filter).length > 0 && (<>
                <Divider style={{color: "white", backgroundColor: "#5b5b5b"}}/>
                <div style={{marginTop: "5px"}}>
                    <ul className={styles["new-file-options-list"]}>
                        {fileTypes(fileDialogShow.data?.filter).map((type) => (
                            <li key={type.ext} className={styles["new-file-option"]}
                                onClick={(e) => selectFileType(e, type.ext)}>{type.name} ({type.ext})</li>
                        ))}
                    </ul>
                </div>
            </>)}
            </DialogBody>
        </Dialog>
    )
}

export default FileDialogComponent
