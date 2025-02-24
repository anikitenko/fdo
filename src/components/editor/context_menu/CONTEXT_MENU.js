import {Item, Menu, Separator, Submenu} from "react-contexify";
import virtualFS from "../utils/VirtualFS";
import {getIconForFile, getIconForFolder} from "vscode-icons-js";

const handleNewContextClick = ({id, event, props}) => {
    let filter = []
    switch (id) {
        case "new-plain-file":
            filter = [".txt", ".md"]
            break;
        case "new-ts-file":
            filter = [".ts", ".tsx"]
            break;
        case "new-js-file":
            filter = [".js", ".jsx", ".mjs"]
            break;
        default:
            break
    }

    virtualFS.openFileDialog({file: "test", node: props.node, filter: filter})
}

const ContextMenu = () => {
    return (
        <Menu id={"CONTEXT_MENU"} theme={"dark"} className={"editor-context-menu"}>
            <Submenu label="New" className={"editor-context-menu-item"}>
                <Item id={"new-plain-file"} onClick={handleNewContextClick}>
                    <img src={"/assets/icons/vscode/" + getIconForFile(".txt")} width="20" height="20"
                         alt="icon"/> Plain file
                </Item>
                <Item id={"new-ts-file"} onClick={handleNewContextClick}>
                    <img src={"/assets/icons/vscode/" + getIconForFile(".ts")} width="20" height="20"
                         alt="icon"/> Typescript file
                </Item>
                <Item id={"new-js-file"} onClick={handleNewContextClick}>
                    <img src={"/assets/icons/vscode/" + getIconForFile(".js")} width="20" height="20"
                         alt="icon"/> Javascript file
                </Item>
                <Item id={"new-folder"}>
                    <img src={"/assets/icons/vscode/" + getIconForFolder("unnamed")} width="20" height="20"
                         alt="icon"/> Folder
                </Item>
            </Submenu>
            <Separator/>
            <Item id={"delete"}>
                Delete
            </Item>
        </Menu>
    )
}

export default ContextMenu;
