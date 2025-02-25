import {Button, ButtonGroup, Tooltip} from "@blueprintjs/core";
import PropTypes from 'prop-types';
import virtualFS from "./utils/VirtualFS";
import styles from './EditorPage.module.css'

const FileTabs = ({openTabs, activeTab, setActiveTab, closeTab, codeEditor}) => (
    <div className={styles["file-tabs"]}>
        {openTabs.map((file) => (
            <FileTabComponent key={file.id} file={file} activeTab={activeTab} setActiveTab={setActiveTab} closeTab={closeTab} codeEditor={codeEditor} />
        ))}
    </div>
);
FileTabs.propTypes = {
    openTabs: PropTypes.array.isRequired,
    activeTab: PropTypes.any,
    setActiveTab: PropTypes.func.isRequired,
    closeTab: PropTypes.func.isRequired,
    codeEditor: PropTypes.any
}

const FileTabComponent = ({file, activeTab, setActiveTab, closeTab, codeEditor}) => {
    return (
        <ButtonGroup>
            <Tooltip content={file.id} placement={"bottom"}
                     className={styles["file-tab-tooltip"]} compact={true} hoverOpenDelay={500}>
                <Button key={file.id} icon={file.icon} small={file.id !== activeTab.id}
                        className={`${styles["file-tab"]} ${file.id === activeTab.id ? styles["active"] : ""}`}
                        onClick={() => {
                            virtualFS.updateModelState(activeTab.id, codeEditor.saveViewState())
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
                    className={`${styles["close-tab-btn"]} ${styles["file-tab"]} ${file.id === activeTab.id ? styles["active"] : ""}`}
                    onClick={(e) => {
                        e.stopPropagation();
                        closeTab(file.id);
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

export default FileTabs
