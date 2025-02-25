import {Item, Menu, Separator, Submenu} from "react-contexify";
import virtualFS from "../utils/VirtualFS";
import {getIconForFile, getIconForFolder} from "vscode-icons-js";
import {PropTypes} from 'prop-types';
import {Alert, Icon} from "@blueprintjs/core";
import {useState} from "react";
import {IconNames} from "@blueprintjs/icons";

const ContextMenu = ({contextElement}) => {
    const [isOpenDelete, setIsOpenDelete] = useState(false)
    const [isLoadingDelete, setIsLoadingDelete] = useState(false)
    const handleNewContextClick = ({id, event, props}) => {
        let filter = []
        switch (id) {
            case "new-file":
                filter = [".nonexistingextension"]
                break;
            case "new-ts-file":
                filter = [".ts", ".tsx"]
                break;
            case "new-js-file":
                filter = [".js", ".jsx", ".mjs"]
                break;
            case "new-md-file":
                filter = [".md"]
                break;
            case "new-txt-file":
                filter = [".txt"]
                break
            default:
                break
        }

        virtualFS.openFileDialog({file: "test", node: props.node, filter: filter})
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
            <Menu id={"CONTEXT_MENU"} theme={"dark"} animation={false} className={"editor-context-menu"}>
                <Item disabled={true}>
                    {contextElement?.label}
                </Item>
                <Separator/>
                <Submenu className={"editor-context-menu-item"} label={<span style={{paddingLeft: "20px"}}>New</span>}>
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
                    <Item id={"new-folder"}>
                        <img src={"/assets/icons/vscode/" + getIconForFolder("unnamed")} width="20" height="20"
                             alt="icon"/> <span style={{paddingLeft: "5px"}}>Folder</span>
                    </Item>
                </Submenu>
                <Separator/>
                <Item onClick={handleDeleteContextClick}>
                    <span style={{paddingLeft: "20px"}}>Save</span>
                </Item>
                <Item onClick={handleDeleteContextClick}>
                    <span style={{paddingLeft: "20px"}}>Rename</span>
                </Item>
                <Separator/>
                <Item onClick={handleDeleteContextClick}>
                    <Icon icon={IconNames.CUT}/> <span style={{paddingLeft: "5px"}}>Cut</span>
                </Item>
                <Item onClick={handleDeleteContextClick}>
                    <Icon icon={IconNames.DUPLICATE}/> <span style={{paddingLeft: "5px"}}>Copy</span>
                </Item>
                <Item onClick={handleDeleteContextClick}>
                    <Icon icon={IconNames.PASTE_VARIABLE}/> <span style={{paddingLeft: "5px"}}>Paste</span>
                </Item>
                <Separator/>
                <Item onClick={handleDeleteContextClick}>
                    <Icon icon={IconNames.TRASH}/> <span style={{paddingLeft: "5px"}}>Delete</span>
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
