import {useEffect, useState} from "react";
import {Dialog, DialogBody, Divider, InputGroup} from "@blueprintjs/core";
import {getIconForFile} from "vscode-icons-js";
import virtualFS from "./utils/VirtualFS";
import {createVirtualFile} from "./utils/createVirtualFile";
import {packageDefaultContent} from "./utils/packageDefaultContent";
import {packageNewFileContent} from "./utils/packageNewFileContent";
import {getFullPathOfFileFolder} from "./utils/getFullPathOfFileFolder";

const FileDialogComponent = () => {
    const [fileDialogShow, setFileDialogShow] = useState(virtualFS.getFileDialog())
    const [newOverlayValue, setNewOverlayValue] = useState("")
    const [fileType, setFileType] = useState("")
    const [newOverlayValueWithExt, setNewOverlayValueWithExt] = useState("")
    const [newOverlayIcon, setNewOverlayIcon] = useState(<img
        src={"/assets/icons/vscode/" + getIconForFile(newOverlayValue)} width="30" height="30" alt="icon"/>)
    const fileTypes = (filter) => {
        const types = [
            {name: "Typescript file", ext: ".ts"},
            {name: "Typescript TSX file", ext: ".tsx"},
            {name: "Javascript file", ext: ".js"},
            {name: "Javascript JSX file", ext: ".jsx"},
            {name: "Javascript module", ext: ".mjs"},
            {name: "Markdown file", ext: ".md"},
        ]
        if (!filter) {
            return types
        }
        return types.filter((type) => (
                filter.includes(type.ext)
            )
        )
    }

    const selectFileType = (e, ext) => {
        const fileOptions = document.getElementsByClassName("new-file-option")
        let existClass = false;
        for (const element of fileOptions) {
            // Remove the class 'active' if it exists
            if (e.currentTarget.classList.contains('selected')) {
                existClass = true;
            }
            element.classList.remove('selected')
        }
        if (!existClass) {
            e.currentTarget.classList.add("selected")
            setFileType(ext)
        } else {
            setFileType("")
        }
        setNewOverlayValue(newOverlayValue + " ")
        setTimeout(() => {
            setNewOverlayValue(newOverlayValue.trimEnd())
        }, 100)
    }

    useEffect(() => {
        if (newOverlayValue) {
            setNewOverlayIcon(
                <img src={"/assets/icons/vscode/" + getIconForFile(newOverlayValue + fileType)} width="30" height="30"
                     alt="icon"/>
            )
        }
        setNewOverlayValueWithExt(newOverlayValue + fileType)
    }, [newOverlayValue]);

    useEffect(() => {
        const unsubscribe = virtualFS.notifications.subscribe("fileDialog", setFileDialogShow);
        return () => unsubscribe(); // Cleanup
    }, []);
    return (
        <Dialog isOpen={fileDialogShow.show}
                onClose={() => virtualFS.closeFileDialog()} style={{width: "45%"}}
        >
            <DialogBody>
                <div style={{textAlign: "center"}}>
                    <span className={"bp5-heading"} style={{color: "white"}}>New File</span>
                </div>
                <InputGroup
                    leftElement={newOverlayIcon}
                    onChange={(e) => setNewOverlayValue(e.target.value)}
                    value={newOverlayValue}
                    placeholder="Name"
                    autoFocus={true}
                    onKeyPress={(e) => {
                        if (e.key === "Enter") {
                            let newFile = newOverlayValueWithExt
                            if (newFile.split("/")[0] !== "") {
                                const prefix = getFullPathOfFileFolder(fileDialogShow.data.node.id, fileDialogShow.data.node.type)
                                newFile = prefix+newOverlayValueWithExt
                            }
                            createVirtualFile(newFile, packageNewFileContent(newFile))
                            virtualFS.setTreeObjectItemBool(newFile, "isSelected")
                            virtualFS.closeFileDialog()
                        }
                    }}
                />
                {fileTypes(fileDialogShow.data?.filter).length > 0 && (<>
                <Divider style={{color: "white", backgroundColor: "#5b5b5b"}}/>
                <div style={{marginTop: "5px"}}>
                    <ul className={"new-file-options-list"}>
                        {fileTypes(fileDialogShow.data?.filter).map((type) => (
                            <li key={type.ext} className={"new-file-option"}
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
