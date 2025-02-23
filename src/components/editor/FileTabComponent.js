import {Button, ButtonGroup, Tooltip} from "@blueprintjs/core";
import PropTypes from 'prop-types';
import virtualFS from "./utils/VirtualFS";

const FileTabComponent = ({file, activeTab, setActiveTab, closeTab, codeEditor}) => {
    return (
        <ButtonGroup>
            <Tooltip content={file.id} placement={"bottom"}
                     className={"file-tab-tooltip"} compact={true} hoverOpenDelay={500}>
                <Button key={file.id} icon={file.icon} small={file.id !== activeTab.id}
                        className={"file-tab" + (file.id === activeTab.id ? " active" : "")}
                        onClick={() => {
                            setActiveTab(file);
                            if (virtualFS.getTreeObjectItemSelected().id === file.id) {
                                codeEditor.setModel(virtualFS.getModel(file.id))
                            } else {
                                virtualFS.setTreeObjectItemBool(file.id, "isSelected")
                            }
                        }} text={file.label}
                />
            </Tooltip>
            <Button icon={"cross"} small={true}
                    className={"close-tab-btn file-tab" + (file.id === activeTab.id ? " active" : "")}
                    onClick={(e) => {
                        e.stopPropagation();
                        closeTab(file);
                    }}
            >
            </Button>
        </ButtonGroup>
    )
}

FileTabComponent.propTypes = {
    file: PropTypes.object.isRequired,
    activeTab: PropTypes.any,
    setActiveTab: PropTypes.func.isRequired,
    closeTab: PropTypes.func.isRequired,
    codeEditor: PropTypes.any
}

export default FileTabComponent;
