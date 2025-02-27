import {Item, Menu, Separator, Submenu} from "react-contexify";
import virtualFS from "../utils/VirtualFS";
import {getIconForFile, getIconForFolder} from "vscode-icons-js";
import {PropTypes} from 'prop-types';
import {Alert, Icon} from "@blueprintjs/core";
import {useState} from "react";
import {IconNames} from "@blueprintjs/icons";
import styles from '../EditorPage.module.css'

const ContextMenu = ({contextElement}) => {
    const [isOpenDelete, setIsOpenDelete] = useState(false)
    const [isLoadingDelete, setIsLoadingDelete] = useState(false)
    const handleNewContextClick = ({id, event, props}) => {
        switch (id) {
            case "new-file":
                virtualFS.openFileDialog({node: props.node, filter: [".nonexistingextension"]})
                break;
            case "new-ts-file":
                virtualFS.openFileDialog({node: props.node, filter: [".ts", ".tsx"]})
                break;
            case "new-js-file":
                virtualFS.openFileDialog({node: props.node, filter: [".js", ".jsx", ".mjs"]})
                break;
            case "new-md-file":
                virtualFS.openFileDialog({node: props.node, filter: [".md"]})
                break;
            case "new-txt-file":
                virtualFS.openFileDialog({node: props.node, filter: [".txt"]})
                break
            case "new-folder":
                virtualFS.openFileDialog({node: props.node, filter: [".nonexistingextension"], type: "folder"})
                break
            case "rename-file-folder":
                virtualFS.openFileDialog({node: props.node, filter: [".nonexistingextension"], action: "rename"})
                break
            default:
                virtualFS.openFileDialog({node: props.node, filter: [".*"]})
        }
    }

    const handleDeleteContextClick = ({id, event, props}) => {
        setIsOpenDelete(true)
    }

    const handleConfirmDelete = (id, event, props) => {
        setIsLoadingDelete(true)
        virtualFS.deleteFile(contextElement.id)
        handleCloseDelete()
    }

    const handleCloseDelete = () => {
        setIsOpenDelete(false)
        setIsLoadingDelete(false)
    }

    return (
        <>
            <Menu id={"CONTEXT_MENU"} theme={"dark"} className={styles["contexify_theme-dark"]} animation={false}>
                <Item disabled={true}>
                    {contextElement?.label}
                </Item>
                <Separator/>
                <Item onClick={handleNewContextClick}>
                    <span style={{paddingLeft: "20px"}}>New file</span>
                </Item>
                <Submenu label={<span style={{paddingLeft: "20px"}}>New</span>}>
                    <Item id={"new-file"} onClick={handleNewContextClick}>
                        <img src={"/assets/icons/vscode/" + getIconForFile(".txt")} width="20" height="20"
                             alt="icon"/> <span style={{paddingLeft: "5px"}}>File</span>
                    </Item>
                    <Item id={"new-ts-file"} onClick={handleNewContextClick}>
                        <img src={"/assets/icons/vscode/" + getIconForFile(".ts")} width="20" height="20"
                             alt="icon"/> <span style={{paddingLeft: "5px"}}>Typescript file</span>
                    </Item>
                    <Item id={"new-js-file"} onClick={handleNewContextClick}>
                        <img src={"/assets/icons/vscode/" + getIconForFile(".js")} width="20" height="20"
                             alt="icon"/> <span style={{paddingLeft: "5px"}}>Javascript file</span>
                    </Item>
                    <Item id={"new-md-file"} onClick={handleNewContextClick}>
                        <img src={"/assets/icons/vscode/" + getIconForFile(".md")} width="20" height="20"
                             alt="icon"/> <span style={{paddingLeft: "5px"}}>Markdown file</span>
                    </Item>
                    <Item id={"new-txt-file"} onClick={handleNewContextClick}>
                        <img src={"/assets/icons/vscode/" + getIconForFile(".txt")} width="20" height="20"
                             alt="icon"/> <span style={{paddingLeft: "5px"}}>Text file</span>
                    </Item>
                    <Separator/>
                    <Item id={"new-folder"} onClick={handleNewContextClick}>
                        <img src={"/assets/icons/vscode/" + getIconForFolder("unnamed")} width="20" height="20"
                             alt="icon"/> <span style={{paddingLeft: "5px"}}>Folder</span>
                    </Item>
                </Submenu>
                <Separator/>
                <Item onClick={handleDeleteContextClick}>
                    <Icon intent={"danger"} icon={IconNames.TRASH}/> <span style={{paddingLeft: "5px"}}>Delete</span>
                </Item>
            </Menu>
            <Alert
                cancelButtonText="Cancel"
                canEscapeKeyCancel={true}
                canOutsideClickCancel={true}
                confirmButtonText="Delete"
                icon={IconNames.TRASH}
                intent={"danger"}
                isOpen={isOpenDelete}
                loading={isLoadingDelete}
                onCancel={handleCloseDelete}
                onConfirm={handleConfirmDelete}
                className={styles["alert-delete"]}
            >
                <p style={{color: "white"}}>
                    Are you sure you want to delete <b>{contextElement?.label}</b>?
                </p>
            </Alert>
        </>
    )
}

ContextMenu.propTypes = {
    contextElement: PropTypes.any
}

export default ContextMenu;
